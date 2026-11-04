import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { ALL_ROLES, authorize } from "@/lib/auth";
import { getAgentBalances } from "@/lib/agent-issues";
import type { AgentBalanceDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * What each field agent holds and owes. Admin and stock incharge see every agent; a field
 * agent only ever sees their own row — scoped here, not in the UI.
 */
export async function GET(req: Request) {
  try {
    const user = await authorize(req, ALL_ROLES);
    const body: AgentBalanceDTO[] = await getAgentBalances(prisma, user.role === "agent" ? user.id : undefined);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
