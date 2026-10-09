import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { lockInvoice, orderInclude, toOrderDTO } from "@/lib/orders";
import type { OrderDTO } from "@/lib/types";

/**
 * Dispatches a billed order: lock the order, confirm it is BILLED (a bill number must be
 * entered first via POST /api/orders/:id/bill) and mark it DISPATCHED. Stock is NOT touched
 * here — it was already deducted when the order was billed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { id } = await params;

    const order = await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      if (invoice.fulfilmentStatus === "PENDING") {
        throw new HttpError(409, `Order ${id} must be billed before it can be dispatched`);
      }
      if (invoice.fulfilmentStatus !== "BILLED") {
        throw new HttpError(409, `Order ${id} is already ${invoice.fulfilmentStatus.toLowerCase()}`);
      }

      return tx.invoice.update({
        where: { id },
        data: { fulfilmentStatus: "DISPATCHED", dispatchedAt: new Date(), dispatchedById: user.id },
        include: orderInclude,
      });
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    const body: OrderDTO = toOrderDTO(order);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
