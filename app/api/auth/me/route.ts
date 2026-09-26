import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import type { AuthUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user: AuthUser = await requireAuth(req);
    return NextResponse.json(user);
  } catch (err) {
    return errorResponse(err);
  }
}
