import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { daysOutstanding, round2 } from "@/lib/money";
import type { LedgerEntry, OutletCreditDTO } from "@/lib/types";

/**
 * Every outlet currently carrying an outstanding balance — available to admin and stock
 * (both can collect payments) and, view-only, agents (scoped to their own route), unlike
 * /api/reports which is admin-only because it also carries company-wide totals and staff
 * performance. Mirrors /api/outlets/:id/ledger's balance convention: invoice-only, no
 * manual corrections folded in, since collecting a payment settles real open invoices
 * rather than a correction — `entries` below is invoice/payment history only, for the same
 * reason (corrections are an admin-only concept, surfaced instead in their own history).
 */
export async function GET(req: Request) {
  try {
    const user = await authorize(req, ["admin", "stock", "agent"]);

    const outlets = await prisma.outlet.findMany({
      where: {
        invoices: { some: { balanceDue: { gt: 0 }, fulfilmentStatus: { not: "CANCELLED" } } },
        route: user.role === "agent" ? { agentId: user.id } : undefined,
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        phone: true,
        route: { select: { name: true, agentId: true, agent: { select: { name: true } } } },
        invoices: {
          where: { fulfilmentStatus: { not: "CANCELLED" } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, invoiceNumber: true, totalAmount: true, balanceDue: true, createdAt: true, _count: { select: { items: true } } },
        },
        payments: {
          select: { id: true, amount: true, paymentMethod: true, invoice: { select: { invoiceNumber: true } }, notes: true, createdAt: true },
        },
      },
    });

    const body: OutletCreditDTO[] = outlets.map((o) => {
      const openInvoices = o.invoices.filter((i) => i.balanceDue > 0);
      const rows: Omit<LedgerEntry, "runningBalance">[] = [
        ...o.invoices.map((inv) => ({
          date: inv.createdAt.toISOString(),
          type: "INVOICE" as const,
          reference: inv.invoiceNumber ?? "Unbilled",
          description: `Invoice (${inv._count.items} item${inv._count.items === 1 ? "" : "s"})`,
          debit: inv.totalAmount,
          credit: 0,
        })),
        ...o.payments.map((p) => ({
          date: p.createdAt.toISOString(),
          type: "PAYMENT" as const,
          reference: p.invoice?.invoiceNumber ?? "Unbilled",
          description: `${p.paymentMethod} payment${p.notes ? ` — ${p.notes}` : ""}`,
          debit: 0,
          credit: p.amount,
        })),
      ];
      rows.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "INVOICE" ? -1 : 1) - (b.type === "INVOICE" ? -1 : 1));
      let running = 0;
      const entries: LedgerEntry[] = rows.map((row) => {
        running = round2(running + row.debit - row.credit);
        return { ...row, runningBalance: running };
      });

      return {
        outletId: o.id,
        outletName: o.name,
        phone: o.phone,
        routeName: o.route?.name ?? null,
        agentId: o.route?.agentId ?? null,
        agentName: o.route?.agent?.name ?? null,
        totalBilled: round2(o.invoices.reduce((s, i) => s + i.totalAmount, 0)),
        totalPaid: round2(o.payments.reduce((s, p) => s + p.amount, 0)),
        balance: round2(openInvoices.reduce((s, i) => s + i.balanceDue, 0)),
        oldestInvoiceDays: openInvoices.length > 0 ? daysOutstanding(openInvoices[0].createdAt) : null,
        openInvoices: openInvoices.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          balanceDue: i.balanceDue,
          createdAt: i.createdAt.toISOString(),
          daysOutstanding: daysOutstanding(i.createdAt),
        })),
        entries,
      };
    });

    // Field agents see their own outlets only — surface the longest-overdue ones first so
    // collection effort goes where it's most needed. Admin/stock keep the alphabetical order.
    if (user.role === "agent") {
      body.sort((a, b) => (b.oldestInvoiceDays ?? -Infinity) - (a.oldestInvoiceDays ?? -Infinity));
    }

    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
