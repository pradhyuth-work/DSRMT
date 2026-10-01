import { csvResponse, errorResponse, toCsv } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { paymentsQuerySchema } from "@/lib/validation";
import { fetchPayments } from "@/lib/payments";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const LIMIT = 300;

/**
 * Downloads the currently-filtered payments list as CSV — same outletId/staffId/from/to
 * query params and the same staffId scoping as GET /api/payments (stock incharge is still
 * forced to their own collections). Admin and stock.
 */
export async function GET(req: Request) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const q = paymentsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const payments = await fetchPayments(user, q, LIMIT);

    const csv = toCsv(
      ["Date", "Outlet", "Collected By", "Method", "Cheque #", "Cheque Date", "Amount", "Invoice #", "Notes"],
      payments.map((p) => [
        new Date(p.createdAt).toLocaleString("en-IN"),
        p.outletName,
        p.staffName,
        p.paymentMethod,
        p.chequeNumber ?? "",
        p.chequeDate ? new Date(p.chequeDate).toLocaleDateString("en-IN") : "",
        formatMoney(p.amount),
        p.invoiceNumber ?? "Unbilled",
        p.notes ?? "",
      ]),
    );

    const range = q.from || q.to ? `${q.from?.toISOString().slice(0, 10) ?? "start"}_${q.to?.toISOString().slice(0, 10) ?? "now"}` : "all-time";
    return csvResponse(csv, `payments-${range}.csv`);
  } catch (err) {
    return errorResponse(err);
  }
}
