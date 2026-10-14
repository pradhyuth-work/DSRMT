import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { daysOutstanding, round2 } from "@/lib/money";
import type { OutletCreditDTO } from "@/lib/types";

/**
 * Every outlet currently carrying an outstanding balance — available to admin and stock
 * (both can collect payments), unlike /api/reports which is admin-only because it also
 * carries company-wide totals and staff performance. Mirrors /api/outlets/:id/ledger's
 * balance convention: invoice-only, no manual corrections folded in, since collecting a
 * payment settles real open invoices rather than a correction.
 */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin", "stock"]);

    const outlets = await prisma.outlet.findMany({
      where: { invoices: { some: { balanceDue: { gt: 0 }, fulfilmentStatus: { not: "CANCELLED" } } } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        phone: true,
        route: { select: { name: true } },
        invoices: {
          where: { balanceDue: { gt: 0 }, fulfilmentStatus: { not: "CANCELLED" } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, invoiceNumber: true, balanceDue: true, createdAt: true },
        },
      },
    });

    const body: OutletCreditDTO[] = outlets.map((o) => ({
      outletId: o.id,
      outletName: o.name,
      phone: o.phone,
      routeName: o.route?.name ?? null,
      balance: round2(o.invoices.reduce((s, i) => s + i.balanceDue, 0)),
      oldestInvoiceDays: o.invoices.length > 0 ? daysOutstanding(o.invoices[0].createdAt) : null,
      openInvoices: o.invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        balanceDue: i.balanceDue,
        createdAt: i.createdAt.toISOString(),
        daysOutstanding: daysOutstanding(i.createdAt),
      })),
    }));
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
