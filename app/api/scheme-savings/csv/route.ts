import { csvResponse, errorResponse, toCsv } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { schemeSavingsQuerySchema } from "@/lib/validation";
import { buildSchemeSavings } from "@/lib/scheme-savings";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Downloads the currently-filtered Scheme Savings bill-level table as CSV — same
 * from/to/outletId/productId/staffId query params as GET /api/scheme-savings. Admin only.
 */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { from, to, outletId, productId, staffId } = schemeSavingsQuerySchema.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    const { bills } = await buildSchemeSavings({ from, to, outletId, productId, staffId });

    const csv = toCsv(
      ["Bill Number", "Outlet", "Agent", "Billed Date", "Billed Amount", "At Scheme", "Saved"],
      bills.map((b) => [
        b.invoiceNumber ?? "",
        b.outletName,
        b.agentName,
        b.billedAt.slice(0, 10),
        formatMoney(b.billedAmount),
        formatMoney(b.atScheme),
        formatMoney(b.saved),
      ]),
    );

    const range = from || to ? `${from?.toISOString().slice(0, 10) ?? "start"}_${to?.toISOString().slice(0, 10) ?? "now"}` : "all-time";
    return csvResponse(csv, `scheme-savings-${range}.csv`);
  } catch (err) {
    return errorResponse(err);
  }
}
