import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { billOrderSchema } from "@/lib/validation";
import { lockInvoice, orderInclude, toOrderDTO } from "@/lib/orders";
import type { OrderDTO } from "@/lib/types";

/**
 * Bills a pending order: records the physical bill-book number by hand and moves it from
 * PENDING to BILLED, the gate a dispatch now requires. Admin and stock only — whoever
 * prepares the paperwork before the physical dispatch.
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
