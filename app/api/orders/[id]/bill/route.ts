import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { billOrderSchema } from "@/lib/validation";
import { lockInvoice, orderInclude, toOrderDTO } from "@/lib/orders";
import type { OrderDTO } from "@/lib/types";

/**
 * Bills a pending order: records the physical bill-book number by hand and moves it from
 * PENDING to BILLED, the gate a dispatch requires. This is also where stock leaves the
 * inventory: lock the order's products, refuse if any is short, deduct stock and record BILL
 * movements — all in one transaction, so nothing changes if any step fails. Admin and stock
 * only — whoever prepares the paperwork before the physical dispatch.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { id } = await params;
    const { invoiceNumber } = await parseBody(req, billOrderSchema);

    const order = await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      if (invoice.fulfilmentStatus !== "PENDING") {
        throw new HttpError(409, `Order ${id} is already ${invoice.fulfilmentStatus.toLowerCase()}`);
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
        const stock = await tx.$queryRaw<{ id: string; name: string; stockQty: number }[]>`
          SELECT "id", "name", "stockQty" FROM "Product"
          WHERE "id" IN (${Prisma.join(productIds)})
          ORDER BY "id"
          FOR UPDATE`;

        const shortages = stock
          .filter((p) => p.stockQty < needed.get(p.id)!)
          .map((p) => `${p.name} (need ${needed.get(p.id)}, have ${p.stockQty})`);
        if (shortages.length > 0) {
          throw new HttpError(400, `Cannot bill ${id}: insufficient stock for ${shortages.join(", ")}`);
        }

        for (const productId of productIds) {
          const quantity = needed.get(productId)!;
          await tx.product.update({ where: { id: productId }, data: { stockQty: { decrement: quantity } } });
          await tx.stockMovement.create({
            data: { productId, change: -quantity, type: "BILL", invoiceId: id, staffId: user.id },
          });
        }
      }

      return tx.invoice.update({
        where: { id },
        data: { invoiceNumber, fulfilmentStatus: "BILLED", billedAt: new Date(), billedById: user.id },
        include: orderInclude,
      });
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    const body: OrderDTO = toOrderDTO(order);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
