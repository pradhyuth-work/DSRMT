import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { updateOrderSchema } from "@/lib/validation";
import { round2, statusFor } from "@/lib/money";
import { lockInvoice, orderInclude, priceLines, toOrderDTO } from "@/lib/orders";
import type { OrderDTO } from "@/lib/types";

/** Admin edit of a PENDING order's outlet and/or items. Totals and payment status are recalculated. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin"]);
    const { id } = await params;
    const input = await parseBody(req, updateOrderSchema);

    const order = await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      if (invoice.fulfilmentStatus !== "PENDING") {
        throw new HttpError(409, `Only pending orders can be edited; ${id} is ${invoice.fulfilmentStatus.toLowerCase()}`);
      }

      if (input.outletId !== undefined && input.outletId !== invoice.outletId) {
        const outlet = await tx.outlet.findUnique({ where: { id: input.outletId }, select: { id: true } });
        if (!outlet) throw new HttpError(400, "Outlet not found");
        const payments = await tx.paymentCollection.count({ where: { invoiceId: id } });
        if (payments > 0) throw new HttpError(409, "Can't move an order with payments to another outlet");
      }

      let totals = {};
      if (input.items) {
        const { lines, totalAmount } = await priceLines(tx, input.items, user.role, invoice.hasScheme);
        if (invoice.paidAmount > totalAmount) {
          throw new HttpError(400, `New total (${totalAmount}) is less than the amount already paid (${invoice.paidAmount})`);
        }
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceItem.createMany({
          data: lines.map(({ productId, quantity, unitPrice, subtotal }) => ({ invoiceId: id, productId, quantity, unitPrice, subtotal })),
        });
        totals = {
          totalAmount,
          balanceDue: round2(totalAmount - invoice.paidAmount),
          status: statusFor(totalAmount, invoice.paidAmount),
        };
      }

      return tx.invoice.update({
        where: { id },
        data: { outletId: input.outletId, ...totals },
        include: orderInclude,
      });
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    const body: OrderDTO = toOrderDTO(order);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
