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
 * stock role sees the payments it personally collected plus every cheque (any admin or stock
 * incharge can flag any cheque as bounced, so they all need to see them) — any staffId filter
 * it sends is ignored — exactly like the JSON endpoint.
 */
export async function fetchPayments(user: AuthUser, filters: PaymentsFilters, limit: number): Promise<PaymentDTO[]> {
  const where: Prisma.PaymentCollectionWhereInput = {
    outletId: filters.outletId,
    ...(user.role === "stock" ? { OR: [{ staffId: user.id }, { paymentMethod: "CHEQUE" }] } : { staffId: filters.staffId }),
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

  // Latest bounce / reflect of each cheque shown, for the "Bounced 17 Oct · reason" line.
  const groupIds = [...new Set(payments.map((p) => p.chequeGroupId).filter((g): g is string => !!g))];
  const events = groupIds.length
    ? await prisma.chequeEvent.findMany({ where: { chequeGroupId: { in: groupIds } }, orderBy: { createdAt: "desc" } })
    : [];
  const lastBounce = new Map<string, (typeof events)[number]>();
  const lastReflect = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    const map = e.action === "BOUNCED" ? lastBounce : lastReflect;
    if (!map.has(e.chequeGroupId)) map.set(e.chequeGroupId, e);
  }

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
    chequeGroupId: p.chequeGroupId,
    chequeStatus: p.chequeStatus,
    chequeBouncedAt: (p.chequeGroupId && lastBounce.get(p.chequeGroupId)?.createdAt.toISOString()) || null,
    chequeBounceReason: (p.chequeGroupId && lastBounce.get(p.chequeGroupId)?.reason) || null,
    chequeReflectedAt: (p.chequeGroupId && lastReflect.get(p.chequeGroupId)?.createdAt.toISOString()) || null,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
  }));
}
