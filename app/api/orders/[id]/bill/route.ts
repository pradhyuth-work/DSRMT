import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { billOrderSchema } from "@/lib/validation";
import { round2, statusFor } from "@/lib/money";
import { lockInvoice, orderInclude, toOrderDTO } from "@/lib/orders";
import { effectiveSchemePrice } from "@/lib/products";
import type { OrderDTO } from "@/lib/types";

/**
 * Bills a pending order: records the physical bill-book number and amount by hand and moves
 * it from PENDING to BILLED, the gate a dispatch now requires. The bill amount overwrites
 * totalAmount/balanceDue/status — the bill book, not the system-computed line total, is the
 * figure payments get collected against from here on. Admin and stock only — whoever
 * prepares the paperwork before the physical dispatch.
 *
 * Also snapshots each line's scheme price (Scheme Savings compares this against the actual
 * unitPrice later) — captured now, once, because Product.schemePrice can change after
 * billing and the live value at that later date wouldn't reflect what applied here.
 *
 * This is also where stock leaves the inventory: lock the order's products, refuse if any is
 * short, deduct stock and record BILL movements — all in the same transaction, so nothing
 * changes if any step fails.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { id } = await params;
    const { invoiceNumber, amount } = await parseBody(req, billOrderSchema);

    const order = await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      if (invoice.fulfilmentStatus !== "PENDING") {
        throw new HttpError(409, `Order ${id} is already ${invoice.fulfilmentStatus.toLowerCase()}`);
      }
      if (amount < invoice.paidAmount) {
        throw new HttpError(400, `Bill amount (${amount}) is less than the amount already paid (${invoice.paidAmount})`);
      }

      const clash = await tx.invoice.findUnique({ where: { invoiceNumber }, select: { id: true } });
      if (clash) throw new HttpError(409, `Bill number "${invoiceNumber}" is already used by another order`);

      const needed = new Map<string, number>();
      for (const item of invoice.items) {
        needed.set(item.productId, (needed.get(item.productId) ?? 0) + item.quantity);
      }
      const productIds = [...needed.keys()].sort();

      if (productIds.length > 0) {
        // Lock in a consistent order so two bills sharing products can't deadlock.
        const stock = await tx.$queryRaw<{ id: string; name: string; stockQty: number; schemePrice: number | null; schemeActive: boolean }[]>`
          SELECT "id", "name", "stockQty", "schemePrice", "schemeActive" FROM "Product"
          WHERE "id" IN (${Prisma.join(productIds)})
          ORDER BY "id"
          FOR UPDATE`;

        const shortages = stock
          .filter((p) => p.stockQty < needed.get(p.id)!)
          .map((p) => `${p.name} (need ${needed.get(p.id)}, have ${p.stockQty})`);
        if (shortages.length > 0) {
          throw new HttpError(400, `Cannot bill ${id}: insufficient stock for ${shortages.join(", ")}`);
        }

        // Batched (one statement each, regardless of item/product count) rather than looped —
        // a per-row loop here hit the transaction timeout on orders with many line items,
        // since every iteration is its own round trip over the Supabase pooler.
        const productById = new Map(stock.map((p) => [p.id, p]));
        const schemePriceRows = invoice.items.map((item) => {
          const product = productById.get(item.productId);
          return Prisma.sql`(${item.id}::text, ${product ? effectiveSchemePrice(product) : null}::double precision)`;
        });
        await tx.$executeRaw`
          UPDATE "InvoiceItem" AS ii
          SET "schemeUnitPrice" = v.price
          FROM (VALUES ${Prisma.join(schemePriceRows)}) AS v(id, price)
          WHERE ii."id" = v.id`;

        const stockRows = productIds.map((productId) => Prisma.sql`(${productId}::text, ${needed.get(productId)!}::int)`);
        await tx.$executeRaw`
          UPDATE "Product" AS p
          SET "stockQty" = p."stockQty" - v.qty
          FROM (VALUES ${Prisma.join(stockRows)}) AS v(id, qty)
          WHERE p."id" = v.id`;

        await tx.stockMovement.createMany({
          data: productIds.map((productId) => ({
            productId,
            change: -needed.get(productId)!,
            type: "BILL" as const,
            invoiceId: id,
            staffId: user.id,
          })),
        });
      }

      return tx.invoice.update({
        where: { id },
        data: {
          invoiceNumber,
          fulfilmentStatus: "BILLED",
          billedAt: new Date(),
          billedById: user.id,
          totalAmount: amount,
          balanceDue: round2(amount - invoice.paidAmount),
          status: statusFor(amount, invoice.paidAmount),
        },
        include: orderInclude,
      });
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    const body: OrderDTO = toOrderDTO(order);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
