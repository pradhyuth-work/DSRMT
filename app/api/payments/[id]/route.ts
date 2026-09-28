import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { round2, statusFor } from "@/lib/money";

/**
 * Deletes a payment and reverses its effect on the invoice it settled: the amount is added
 * back to balanceDue and removed from paidAmount, and the invoice's status is recomputed.
 * A payment with no linked invoice (shouldn't happen in practice, but the column is
 * nullable) is just removed. Admin only — this corrects a wrongly-entered collection.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin"]);
    const { id } = await params;

    await prisma.$transaction(async (tx) => {
      const payment = await tx.paymentCollection.findUnique({ where: { id } });
      if (!payment) throw new HttpError(404, "Payment not found");

      if (payment.invoiceId) {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Invoice" WHERE "id" = ${payment.invoiceId} FOR UPDATE`;
        if (rows.length > 0) {
          const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
          const paidAmount = round2(invoice.paidAmount - payment.amount);
          const balanceDue = round2(invoice.balanceDue + payment.amount);
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { paidAmount, balanceDue, status: statusFor(invoice.totalAmount, paidAmount) },
          });
        }
      }

      await tx.paymentCollection.delete({ where: { id } });
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
