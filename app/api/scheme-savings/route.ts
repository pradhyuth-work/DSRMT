import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { schemeSavingsQuerySchema } from "@/lib/validation";
import { buildSchemeSavings } from "@/lib/scheme-savings";
import type { SchemeSavingsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Summary, breakdowns (by outlet/product/agent/month) and the bills list for the given
 * filters — admin only, read-only. See GET .../bills to re-fetch just the bills list. */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { from, to, outletId, productId, staffId } = schemeSavingsQuerySchema.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    const body: SchemeSavingsResponse = await buildSchemeSavings({ from, to, outletId, productId, staffId });
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
