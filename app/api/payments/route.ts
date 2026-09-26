import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { createPaymentSchema, paymentsQuerySchema } from "@/lib/validation";
import { round2, statusFor } from "@/lib/money";
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

    const payments = await prisma.paymentCollection.findMany({
      where: {
        outletId: q.outletId,
        staffId: user.role === "stock" ? user.id : q.staffId,
        createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      include: { outlet: { select: { name: true } }, staff: { select: { name: true } } },
    });

    const body: PaymentDTO[] = payments.map((p) => ({
      id: p.id,
      outletId: p.outletId,
      outletName: p.outlet.name,
      staffId: p.staffId,
      staffName: p.staff.name,
      invoiceId: p.invoiceId,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      notes: p.notes,
      createdAt: p.createdAt.toISOString(),
    }));
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
 * Admin can attribute the collection to any staff member (whoever actually collected the
 * cash in the field). Stock incharge can only ever attribute it to themselves.
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const input = await parseBody(req, createPaymentSchema);
    const staffId = user.role === "stock" ? user.id : input.staffId;
    if (!staffId) throw new HttpError(400, "staffId: Select who collected this payment");
    const amount = round2(input.amount);

    const allocations = await prisma.$transaction(async (tx) => {
      const [outlet, staff] = await Promise.all([
        tx.outlet.findUnique({ where: { id: input.outletId }, select: { id: true } }),
        tx.staff.findUnique({ where: { id: staffId }, select: { id: true } }),
      ]);
      if (!outlet) throw new HttpError(400, "Outlet not found");
      if (!staff) throw new HttpError(400, "Staff member not found");

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
      let remaining = amount;
      for (const inv of openInvoices) {
        if (remaining <= 0) break;
        const applied = round2(Math.min(remaining, inv.balanceDue));
        const paidAmount = round2(inv.paidAmount + applied);
        const balanceDue = round2(inv.totalAmount - paidAmount);
        const status = statusFor(inv.totalAmount, paidAmount);

        await tx.invoice.update({ where: { id: inv.id }, data: { paidAmount, balanceDue, status } });
        await tx.paymentCollection.create({
          data: {
            outletId: input.outletId,
            staffId,
            invoiceId: inv.id,
            amount: applied,
            paymentMethod: input.paymentMethod,
            notes: input.notes || null,
          },
        });

        result.push({ invoiceId: inv.id, applied, balanceDue, status });
        remaining = round2(remaining - applied);
      }
      return result;
    });

    const body: CreatePaymentResponse = { amount, allocations };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
