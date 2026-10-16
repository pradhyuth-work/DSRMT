import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { schemeSavingsQuerySchema } from "@/lib/validation";
import { buildSchemeSavings } from "@/lib/scheme-savings";
import type { SchemeSavingsBillRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Just the bills list for the given filters, for refreshing the Bills tab without re-sending
 * the breakdown arrays. Admin only, read-only; same filters/scoping as GET /api/scheme-savings. */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { from, to, outletId, productId, staffId } = schemeSavingsQuerySchema.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    const { bills } = await buildSchemeSavings({ from, to, outletId, productId, staffId });
    const body: SchemeSavingsBillRow[] = bills;
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
