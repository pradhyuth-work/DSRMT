import { NextResponse } from "next/server";
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

      const products = await tx.product.findMany({
        where: { id: { in: invoice.items.map((i) => i.productId) } },
        select: { id: true, schemePrice: true, schemeActive: true },
      });
      const productById = new Map(products.map((p) => [p.id, p]));
      for (const item of invoice.items) {
        const product = productById.get(item.productId);
        await tx.invoiceItem.update({
          where: { id: item.id },
          data: { schemeUnitPrice: product ? effectiveSchemePrice(product) : null },
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
