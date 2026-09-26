import { prisma } from "./prisma";
import { round2 } from "./money";
import type { LedgerEntry, OutletLedger, ReportsResponse, StaffPerformance } from "./types";

export async function buildReports(): Promise<ReportsResponse> {
  const [invoiceTotals, paymentTotals, stockTotals, outlets, staff, staffInvoices, staffPayments] =
    await Promise.all([
      prisma.invoice.aggregate({ _sum: { totalAmount: true, balanceDue: true }, _count: true }),
      prisma.paymentCollection.aggregate({ _sum: { amount: true } }),
      prisma.product.aggregate({ _sum: { stockQty: true } }),
      prisma.outlet.findMany({
        orderBy: { name: "asc" },
        include: {
          invoices: { select: { id: true, totalAmount: true, balanceDue: true, createdAt: true, _count: { select: { items: true } } } },
          payments: { select: { id: true, amount: true, paymentMethod: true, invoiceId: true, notes: true, createdAt: true } },
        },
      }),
      prisma.staff.findMany({ orderBy: { name: "asc" } }),
      prisma.invoice.groupBy({
        by: ["staffId"],
        _count: { _all: true },
        _sum: { totalAmount: true, balanceDue: true },
      }),
      prisma.paymentCollection.groupBy({
        by: ["staffId", "paymentMethod"],
        _sum: { amount: true },
      }),
    ]);

  const outletLedgers: OutletLedger[] = outlets.map((outlet) => {
    const rows: Omit<LedgerEntry, "runningBalance">[] = [
      ...outlet.invoices.map((inv) => ({
        date: inv.createdAt.toISOString(),
        type: "INVOICE" as const,
        reference: inv.id,
        description: `Invoice (${inv._count.items} item${inv._count.items === 1 ? "" : "s"})`,
        debit: inv.totalAmount,
        credit: 0,
      })),
      ...outlet.payments.map((p) => ({
        date: p.createdAt.toISOString(),
        type: "PAYMENT" as const,
        reference: p.invoiceId ?? p.id,
        description: `${p.paymentMethod} payment${p.notes ? ` — ${p.notes}` : ""}`,
        debit: 0,
        credit: p.amount,
      })),
    ];
    // Chronological; on identical timestamps invoices come before the payments that settle them.
    rows.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "INVOICE" ? -1 : 1) - (b.type === "INVOICE" ? -1 : 1));

    let running = 0;
    const entries: LedgerEntry[] = rows.map((row) => {
      running = round2(running + row.debit - row.credit);
      return { ...row, runningBalance: running };
    });

    const totalBilled = round2(outlet.invoices.reduce((s, i) => s + i.totalAmount, 0));
    const totalPaid = round2(outlet.payments.reduce((s, p) => s + p.amount, 0));
    return {
      outletId: outlet.id,
      outletName: outlet.name,
      phone: outlet.phone,
      totalBilled,
      totalPaid,
      balance: round2(outlet.invoices.reduce((s, i) => s + i.balanceDue, 0)),
      openInvoices: outlet.invoices
        .filter((i) => i.balanceDue > 0)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((i) => ({ id: i.id, balanceDue: i.balanceDue, createdAt: i.createdAt.toISOString() })),
      entries,
    };
  });

  const staffPerformance: StaffPerformance[] = staff.map((member) => {
    const inv = staffInvoices.find((g) => g.staffId === member.id);
    const sumFor = (method: "CASH" | "UPI") =>
      staffPayments.find((g) => g.staffId === member.id && g.paymentMethod === method)?._sum.amount ?? 0;
    const cashCollected = round2(sumFor("CASH"));
    const upiCollected = round2(sumFor("UPI"));
    return {
      staffId: member.id,
      staffName: member.name,
      phone: member.phone,
      totalOrders: inv?._count._all ?? 0,
      totalSales: round2(inv?._sum.totalAmount ?? 0),
      totalCollected: round2(cashCollected + upiCollected),
      cashCollected,
      upiCollected,
      uncollectedBalance: round2(inv?._sum.balanceDue ?? 0),
    };
  });

  return {
    dashboard: {
      totalBilled: round2(invoiceTotals._sum.totalAmount ?? 0),
      totalCollected: round2(paymentTotals._sum.amount ?? 0),
      totalOutstanding: round2(invoiceTotals._sum.balanceDue ?? 0),
      totalStockUnits: stockTotals._sum.stockQty ?? 0,
      invoiceCount: invoiceTotals._count,
    },
    outletLedgers,
    staffPerformance,
  };
}
