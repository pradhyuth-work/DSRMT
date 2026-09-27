import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { daysOutstanding, round2 } from "@/lib/money";
import type { OutletBalanceDTO } from "@/lib/types";

/**
 * Just enough of an outlet's ledger to collect a payment sensibly: its outstanding balance
 * and open invoices, oldest first (the order a payment settles them in). Available to admin
 * and stock (both can now collect payments) without exposing the full admin-only reports.
 *
 * `balance` here stays invoice-only (unlike OutletLedger.balance in the full reports view,
 * which also folds in manual corrections) — collecting a payment settles real open
 * invoices, oldest first, and a correction isn't tied to any one of them to settle.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin", "stock"]);
    const { id } = await params;

    const outlet = await prisma.outlet.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!outlet) throw new HttpError(404, "Outlet not found");

    const openInvoices = await prisma.invoice.findMany({
      where: { outletId: id, balanceDue: { gt: 0 }, fulfilmentStatus: { not: "CANCELLED" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, invoiceNumber: true, balanceDue: true, createdAt: true },
    });

    const body: OutletBalanceDTO = {
      outletId: outlet.id,
      outletName: outlet.name,
      balance: round2(openInvoices.reduce((s, i) => s + i.balanceDue, 0)),
      oldestInvoiceDays: openInvoices.length > 0 ? daysOutstanding(openInvoices[0].createdAt) : null,
      openInvoices: openInvoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        balanceDue: i.balanceDue,
        createdAt: i.createdAt.toISOString(),
        daysOutstanding: daysOutstanding(i.createdAt),
      })),
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
