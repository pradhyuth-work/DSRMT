import { csvResponse, errorResponse, toCsv } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { salesReportQuerySchema } from "@/lib/validation";
import { buildSalesReport } from "@/lib/reports";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Downloads the currently-filtered sales report as one CSV: the by-product breakdown, a
 * blank line, then the by-outlet breakdown — same from/to/outletId query params as
 * GET /api/reports/sales. Admin only.
 */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { from, to, outletId } = salesReportQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const report = await buildSalesReport({ from, to, outletId });

    const byProductCsv = toCsv(
      ["Product", "Unit Price", "Orders", "Qty Sold", "Revenue", "% of Total"],
      report.byProduct.map((p) => [p.productName, formatMoney(p.unitPrice), p.orders, p.qtySold, formatMoney(p.revenue), `${p.pctOfTotal}%`]),
    );
    const byOutletCsv = toCsv(
      ["Outlet", "Orders", "Gross Sales", "Payments Received", "Balance", "Days of Credit (Oldest Open Invoice)"],
      report.byOutlet.map((o) => [
        o.outletName,
        o.orders,
        formatMoney(o.grossSales),
        formatMoney(o.paymentsReceived),
        formatMoney(o.balance),
        o.oldestInvoiceDays ?? "",
      ]),
    );

    const csv = `By Product\r\n${byProductCsv}\r\nBy Outlet\r\n${byOutletCsv}`;
    const range = from || to ? `${from?.toISOString().slice(0, 10) ?? "start"}_${to?.toISOString().slice(0, 10) ?? "now"}` : "all-time";
    return csvResponse(csv, `sales-report-${range}.csv`);
  } catch (err) {
    return errorResponse(err);
  }
}
