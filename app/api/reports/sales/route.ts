import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { salesReportQuerySchema } from "@/lib/validation";
import { buildSalesReport } from "@/lib/reports";
import type { SalesReportResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { from, to, outletId } = salesReportQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const body: SalesReportResponse = await buildSalesReport({ from, to, outletId });
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
