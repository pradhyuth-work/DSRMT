import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { lockInvoice, orderInclude, toOrderDTO } from "@/lib/orders";
import type { OrderDTO } from "@/lib/types";

/**
 * Cancels an order.
 * - Agents: only their own PENDING (not yet billed) orders.
 * - Admins: any PENDING, BILLED or DISPATCHED order. Cancelling a dispatched order returns
 *   its stock and records CANCEL_RETURN movements. A bill number already assigned stays on
 *   the cancelled order rather than being freed for reuse.
 * Orders with payments recorded against them cannot be cancelled (reverse the payment first).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin", "agent"]);
    const { id } = await params;

    const order = await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);

      // Agents get a 404 for orders they don't own, so they can't probe other people's ids.
      if (user.role === "agent" && invoice.staffId !== user.id) throw new HttpError(404, "Order not found");
      if (invoice.fulfilmentStatus === "CANCELLED") throw new HttpError(409, `Order ${id} is already cancelled`);
      if (user.role === "agent" && invoice.fulfilmentStatus !== "PENDING") {
        throw new HttpError(409, `Order ${id} has already been billed and can't be cancelled by an agent`);
      }

      const payments = await tx.paymentCollection.count({ where: { invoiceId: id } });
      if (payments > 0) {
        throw new HttpError(409, `Order ${id} has payments recorded against it and can't be cancelled`);
      }

      if (invoice.fulfilmentStatus === "DISPATCHED") {
        for (const item of invoice.items) {
          await tx.product.update({ where: { id: item.productId }, data: { stockQty: { increment: item.quantity } } });
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              change: item.quantity,
              type: "CANCEL_RETURN",
              reason: `Order ${id} cancelled`,
              invoiceId: id,
              staffId: user.id,
            },
          });
        }
      }

      return tx.invoice.update({
        where: { id },
        data: { fulfilmentStatus: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id },
        include: orderInclude,
      });
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    const body: OrderDTO = toOrderDTO(order);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
