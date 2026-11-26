import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { reverseBillSchema } from "@/lib/validation";
import { lockInvoice, orderInclude, toOrderDTO } from "@/lib/orders";
import { addReusable } from "@/lib/invoice-series";
import { activeLiveEinvoice, numberFiled } from "@/lib/einvoice-live";
import { appendInvoiceAudit } from "@/lib/invoice-audit";
import type { OrderDTO } from "@/lib/types";

/**
 * Cancel or correct a billed invoice (data-entry mistakes). Admin only.
 *  - returnToPending: the order goes back to Pending and can be billed again; otherwise it is cancelled.
 *  - reuseNumber: the invoice number goes back to the MTR series. Only for a number of that series that
 *    was never put in an e-invoice file. A number that is not reused is gone for good.
 * A bill whose live IRN is still active is refused unless `force` is set (cancel the IRN first when the
 * portal still allows it); a number that reached the portal is never reused.
 * Stock is returned. An order with payments against it is refused (reverse the payment first).
 * Every reversal is written to the audit log with who, when and why.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin"]);
    const { id } = await params;
    const input = await parseBody(req, reverseBillSchema);

    const order = await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      if (invoice.fulfilmentStatus !== "BILLED" && invoice.fulfilmentStatus !== "DISPATCHED") {
        throw new HttpError(409, "Only a billed or dispatched invoice can be cancelled or corrected here");
      }
      const number = invoice.invoiceNumber;
      if (!number) throw new HttpError(409, "This order has no invoice number");
      if (input.confirm !== number) throw new HttpError(400, `Type ${number} exactly to confirm`);

      if (invoice.posBill && input.returnToPending) throw new HttpError(400, "A POS bill can only be cancelled, not returned to Pending");

      const payments = await tx.paymentCollection.count({ where: { invoiceId: id } });
      if (payments > 0) throw new HttpError(409, "Payments are recorded against this invoice — reverse them first");

      const active = await activeLiveEinvoice(tx, id);
      // Never override a request that is still on its way to the portal.
      if (active?.status === "SENDING" && Date.now() - active.updatedAt.getTime() < 120_000) {
        throw new HttpError(409, `${number} is being sent to the portal right now: wait a moment and try again`);
      }
      if (active && !input.force) {
        throw new HttpError(409, active.irn
          ? `${number} has an active IRN. Cancel the IRN first, or tick "cancel in the app anyway" if the portal no longer allows it.`
          : `${number} was sent to the portal and no clear reply came back. Press "Check again" under E-invoice first.`);
      }

      if (input.reuseNumber) {
        if (invoice.billedOutside) throw new HttpError(400, "A number written outside the app can't be reused here");
        if (invoice.einvExportedAt) throw new HttpError(400, "This invoice was already in an e-invoice file, so its number can't be reused");
        if (await numberFiled(tx, number)) throw new HttpError(400, "This number was filed on the government portal, so it can't be reused");
        await addReusable(tx, number);
      }

      for (const item of invoice.items) {
        await tx.product.update({ where: { id: item.productId }, data: { stockQty: { increment: item.quantity } } });
        await tx.stockMovement.create({
          data: { productId: item.productId, change: item.quantity, type: "CANCEL_RETURN", reason: `Invoice ${number} ${input.returnToPending ? "reversed" : "cancelled"}: ${input.reason}`, invoiceId: id, staffId: user.id },
        });
      }

      await appendInvoiceAudit(tx, {
        at: new Date().toISOString(),
        by: user.name,
        invoiceNumber: number,
        orderId: id,
        action: input.returnToPending ? "RETURN_TO_PENDING" : "CANCEL",
        reason: active ? `${input.reason} (IRN left active on the portal)` : input.reason,
        numberReused: input.reuseNumber,
      });

      // The number leaves the row when it is handed back (it must stay unique); otherwise a cancelled
      // invoice keeps it, and a returned-to-pending order drops it (the audit log remembers it).
      const keepNumber = !input.reuseNumber && !input.returnToPending;
      if (input.returnToPending) {
        const total = Math.round(invoice.items.reduce((sum, i) => sum + i.subtotal, 0));
        return tx.invoice.update({
          where: { id },
          data: {
            invoiceNumber: null,
            fulfilmentStatus: "PENDING",
            billedAt: null,
            billedById: null,
            dispatchedAt: null,
            dispatchedById: null,
            billedOutside: false,
            vehicleNo: null,
            einvExportedAt: null,
            totalAmount: total,
            balanceDue: total - invoice.paidAmount,
            status: invoice.paidAmount <= 0 ? "UNPAID" : invoice.paidAmount >= total ? "PAID" : "PARTIAL",
          },
          include: orderInclude,
        });
      }
      return tx.invoice.update({
        where: { id },
        data: { fulfilmentStatus: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id, ...(keepNumber ? {} : { invoiceNumber: null }) },
        include: orderInclude,
      });
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    const body: OrderDTO = toOrderDTO(order);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
