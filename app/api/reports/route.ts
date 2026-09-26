import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { buildReports } from "@/lib/reports";
import type { ReportsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const body: ReportsResponse = await buildReports();
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
