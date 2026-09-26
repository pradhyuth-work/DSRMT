import { prisma } from "./prisma";
import { round2 } from "./money";
import type {
  LedgerEntry,
  OutletLedger,
  OutletSalesRow,
  ProductSalesRow,
  ReportsResponse,
  SalesReportResponse,
  SkuMatrixResponse,
  StaffPerformance,
} from "./types";

// Cancelled orders never have payments (cancelling is refused once money is collected),
// so excluding them from billing keeps every total consistent.
const notCancelled = { fulfilmentStatus: { not: "CANCELLED" } } as const;

export interface ReportsRange {
  from?: Date;
  to?: Date;
}

/**
 * Dashboard totals and outlet ledgers are always all-time. Only staffPerformance is
 * date-filtered (by `range`, when given): sales figures by the order's date, collection
 * figures by the payment's date — that's the accrual-vs-cash distinction the two numbers
 * actually represent, so a payment collected today against an old order still counts today.
 */
export async function buildReports(range: ReportsRange = {}): Promise<ReportsResponse> {
  const dateFilter = range.from || range.to ? { gte: range.from, lte: range.to } : undefined;

  const [invoiceTotals, paymentTotals, stockTotals, outlets, staff, staffInvoices, staffPayments] =
    await Promise.all([
      prisma.invoice.aggregate({ where: notCancelled, _sum: { totalAmount: true, balanceDue: true }, _count: true }),
      prisma.paymentCollection.aggregate({ _sum: { amount: true } }),
      prisma.product.aggregate({ _sum: { stockQty: true } }),
      prisma.outlet.findMany({
        orderBy: { name: "asc" },
        include: {
          route: { select: { name: true, agentId: true, agent: { select: { name: true } } } },
          invoices: { where: notCancelled, select: { id: true, totalAmount: true, balanceDue: true, createdAt: true, _count: { select: { items: true } } } },
          payments: { select: { id: true, amount: true, paymentMethod: true, invoiceId: true, notes: true, createdAt: true } },
        },
      }),
      prisma.staff.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, phone: true } }),
      prisma.invoice.groupBy({
        by: ["staffId"],
        where: { ...notCancelled, createdAt: dateFilter },
        _count: { _all: true },
        _sum: { totalAmount: true, balanceDue: true },
      }),
      prisma.paymentCollection.groupBy({
        by: ["staffId", "paymentMethod"],
        where: { createdAt: dateFilter },
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
      routeId: outlet.routeId,
      routeName: outlet.route?.name ?? null,
      agentId: outlet.route?.agentId ?? null,
      agentName: outlet.route?.agent?.name ?? null,
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

export interface SalesReportFilters {
  from?: Date;
  to?: Date;
  outletId?: string;
}

/**
 * The admin "Sales reports" view: orders and payments dated within `filters.from`/`to`
 * (same accrual-vs-cash split as staffPerformance), optionally narrowed to one outlet.
 * By-product and SKU-matrix quantities come from invoice line items, not payments.
 */
export async function buildSalesReport(filters: SalesReportFilters = {}): Promise<SalesReportResponse> {
  const dateFilter = filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined;
  const invoiceWhere = { ...notCancelled, createdAt: dateFilter, outletId: filters.outletId };
  const paymentWhere = { createdAt: dateFilter, outletId: filters.outletId };

  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: invoiceWhere,
      select: {
        id: true,
        totalAmount: true,
        outletId: true,
        outlet: { select: { name: true } },
        items: {
          select: {
            productId: true,
            quantity: true,
            subtotal: true,
            product: { select: { name: true, unitPrice: true } },
          },
        },
      },
    }),
    prisma.paymentCollection.groupBy({ by: ["outletId"], where: paymentWhere, _sum: { amount: true } }),
  ]);

  const totalSales = round2(invoices.reduce((s, inv) => s + inv.totalAmount, 0));
  const totalPayments = round2(payments.reduce((s, p) => s + (p._sum.amount ?? 0), 0));
  const paymentsByOutlet = new Map(payments.map((p) => [p.outletId, round2(p._sum.amount ?? 0)]));

  const productAgg = new Map<string, { productName: string; unitPrice: number; orders: Set<string>; qtySold: number; revenue: number }>();
  const outletAgg = new Map<string, { outletName: string; orders: number; grossSales: number }>();

  for (const inv of invoices) {
    const outlet = outletAgg.get(inv.outletId) ?? { outletName: inv.outlet.name, orders: 0, grossSales: 0 };
    outlet.orders += 1;
    outlet.grossSales = round2(outlet.grossSales + inv.totalAmount);
    outletAgg.set(inv.outletId, outlet);

    for (const item of inv.items) {
      const p = productAgg.get(item.productId) ?? {
        productName: item.product.name,
        unitPrice: item.product.unitPrice,
        orders: new Set<string>(),
        qtySold: 0,
        revenue: 0,
      };
      p.orders.add(inv.id);
      p.qtySold += item.quantity;
      p.revenue = round2(p.revenue + item.subtotal);
      productAgg.set(item.productId, p);
    }
  }

  const byProduct: ProductSalesRow[] = [...productAgg.entries()]
    .map(([productId, p]) => ({
      productId,
      productName: p.productName,
      unitPrice: p.unitPrice,
      orders: p.orders.size,
      qtySold: p.qtySold,
      revenue: p.revenue,
      pctOfTotal: totalSales > 0 ? round2((p.revenue / totalSales) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const byOutlet: OutletSalesRow[] = [...outletAgg.entries()]
    .map(([outletId, o]) => {
      const paymentsReceived = paymentsByOutlet.get(outletId) ?? 0;
      return {
        outletId,
        outletName: o.outletName,
        orders: o.orders,
        grossSales: o.grossSales,
        paymentsReceived,
        balance: round2(o.grossSales - paymentsReceived),
      };
    })
    .sort((a, b) => b.grossSales - a.grossSales);

  const skuOutlets = [...outletAgg.entries()]
    .map(([id, o]) => ({ id, name: o.outletName, total: 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const skuProducts = byProduct
    .map((p) => ({ id: p.productId, name: p.productName, total: 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const outletIndex = new Map(skuOutlets.map((o, i) => [o.id, i]));
  const productIndex = new Map(skuProducts.map((p, i) => [p.id, i]));
  const cells: number[][] = skuOutlets.map(() => skuProducts.map(() => 0));

  for (const inv of invoices) {
    const oi = outletIndex.get(inv.outletId);
    if (oi === undefined) continue;
    for (const item of inv.items) {
      const pi = productIndex.get(item.productId);
      if (pi === undefined) continue;
      cells[oi][pi] += item.quantity;
      skuOutlets[oi].total += item.quantity;
      skuProducts[pi].total += item.quantity;
    }
  }

  const skuMatrix: SkuMatrixResponse = { outlets: skuOutlets, products: skuProducts, cells };

  return { ordersCount: invoices.length, totalSales, totalPayments, byProduct, byOutlet, skuMatrix };
}
