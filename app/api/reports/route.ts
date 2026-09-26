import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { reportsQuerySchema } from "@/lib/validation";
import { buildReports } from "@/lib/reports";
import type { ReportsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { from, to } = reportsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const body: ReportsResponse = await buildReports({ from, to });
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
