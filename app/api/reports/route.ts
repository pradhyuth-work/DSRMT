import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { buildReports } from "@/lib/reports";
import type { ReportsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const body: ReportsResponse = await buildReports();
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
