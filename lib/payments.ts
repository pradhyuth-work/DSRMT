import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { AuthUser, PaymentDTO } from "./types";

export interface PaymentsFilters {
  outletId?: string;
  staffId?: string;
  from?: Date;
  to?: Date;
}

/**
 * Shared by GET /api/payments and GET /api/payments/csv so the two never drift apart: the
 * stock role only ever sees payments it personally collected — any staffId filter it sends
 * is ignored in favour of its own id — exactly like the JSON endpoint.
 */
export async function fetchPayments(user: AuthUser, filters: PaymentsFilters, limit: number): Promise<PaymentDTO[]> {
  const where: Prisma.PaymentCollectionWhereInput = {
    outletId: filters.outletId,
    staffId: user.role === "stock" ? user.id : filters.staffId,
    createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
  };

  const payments = await prisma.paymentCollection.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      outlet: { select: { name: true } },
      staff: { select: { name: true } },
      invoice: { select: { invoiceNumber: true } },
    },
  });

  return payments.map((p) => ({
    id: p.id,
    outletId: p.outletId,
    outletName: p.outlet.name,
    staffId: p.staffId,
    staffName: p.staff.name,
    invoiceId: p.invoiceId,
    invoiceNumber: p.invoice?.invoiceNumber ?? null,
    amount: p.amount,
    paymentMethod: p.paymentMethod,
    chequeNumber: p.chequeNumber,
    chequeDate: p.chequeDate?.toISOString() ?? null,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
  }));
}
