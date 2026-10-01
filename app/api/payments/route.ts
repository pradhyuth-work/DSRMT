import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { createPaymentSchema, paymentsQuerySchema } from "@/lib/validation";
import { round2, statusFor } from "@/lib/money";
import { fetchPayments } from "@/lib/payments";
import type { CreatePaymentResponse, PaymentAllocation, PaymentDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIMIT = 300;

/**
 * Lists payment collections, newest first. Admin sees everyone's and can filter by
 * outlet/staff/date. Stock incharge only ever sees payments they personally collected —
 * any staffId filter they send is ignored in favour of their own id.
 */
export async function GET(req: Request) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const q = paymentsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const body: PaymentDTO[] = await fetchPayments(user, q, LIMIT);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Records a collection against an outlet and settles its open invoices oldest-first (FIFO).
 * One PaymentCollection row is written per invoice the payment touches, so every rupee is
 * traceable to the invoice it settled.
 *
 * Received by defaults to the signed-in user. Admin may attribute it to another admin/stock
 * user; stock incharge can only ever attribute it to themselves. Field agents never can.
 * A CHEQUE payment carries one or more cheques (serial number + date); each settles invoices in turn.
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const input = await parseBody(req, createPaymentSchema);
    // Received by: the signed-in user by default. Only admins and stock incharges can receive
    // payments, so an admin may name another of those — never a field agent.
    const staffId = user.role === "stock" ? user.id : input.staffId ?? user.id;

    // One entry per cheque (each settles invoices in turn, FIFO); a single entry otherwise.
    const parts =
      input.paymentMethod === "CHEQUE"
        ? (input.cheques ?? []).map((c) => ({
            amount: round2(c.amount),
            chequeNumber: c.serialNumber,
            chequeDate: new Date(`${c.date}T00:00:00.000Z`),
          }))
        : [{ amount: round2(input.amount ?? 0), chequeNumber: null, chequeDate: null }];
    const amount = round2(parts.reduce((sum, p) => sum + p.amount, 0));

    const allocations = await prisma.$transaction(async (tx) => {
      const [outlet, staff] = await Promise.all([
        tx.outlet.findUnique({ where: { id: input.outletId }, select: { id: true } }),
        tx.staff.findUnique({ where: { id: staffId }, select: { id: true, role: true } }),
      ]);
      if (!outlet) throw new HttpError(400, "Outlet not found");
      if (!staff) throw new HttpError(400, "Staff member not found");
      if (staff.role === "agent") throw new HttpError(400, "Only an admin or manager can receive payments");

      // Lock the outlet's open invoices so concurrent collections can't apply to the same balance.
      await tx.$queryRaw`
        SELECT "id" FROM "Invoice"
        WHERE "outletId" = ${input.outletId} AND "balanceDue" > 0 AND "fulfilmentStatus" <> 'CANCELLED'
        FOR UPDATE`;
      const openInvoices = await tx.invoice.findMany({
        where: { outletId: input.outletId, balanceDue: { gt: 0 }, fulfilmentStatus: { not: "CANCELLED" } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const outstanding = round2(openInvoices.reduce((sum, inv) => sum + inv.balanceDue, 0));
      if (outstanding <= 0) throw new HttpError(400, "This outlet has no outstanding balance");
      if (amount > outstanding) {
        throw new HttpError(400, `Payment (${amount}) exceeds outstanding balance (${outstanding})`);
      }

      const result: PaymentAllocation[] = [];
      for (const part of parts) {
        let remaining = part.amount;
        for (const inv of openInvoices) {
          if (remaining <= 0) break;
          if (inv.balanceDue <= 0) continue;
          const applied = round2(Math.min(remaining, inv.balanceDue));
          inv.paidAmount = round2(inv.paidAmount + applied);
          inv.balanceDue = round2(inv.totalAmount - inv.paidAmount);
          const status = statusFor(inv.totalAmount, inv.paidAmount);

          await tx.invoice.update({
            where: { id: inv.id },
            data: { paidAmount: inv.paidAmount, balanceDue: inv.balanceDue, status },
          });
          await tx.paymentCollection.create({
            data: {
              outletId: input.outletId,
              staffId,
              invoiceId: inv.id,
              amount: applied,
              paymentMethod: input.paymentMethod,
              chequeNumber: part.chequeNumber,
              chequeDate: part.chequeDate,
              notes: input.notes || null,
            },
          });

          result.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, applied, balanceDue: inv.balanceDue, status });
          remaining = round2(remaining - applied);
        }
      }
      return result;
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    const body: CreatePaymentResponse = { amount, allocations };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
