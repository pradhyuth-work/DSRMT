import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse } from "@/lib/api";
import { ALL_ROLES, authorize } from "@/lib/auth";
import { getAgentLedger } from "@/lib/agent-issues";
import type { AgentLedgerEntryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** One agent's issues and settlements with a running balance. A field agent can only open their own. */
export async function GET(req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const user = await authorize(req, ALL_ROLES);
    const { agentId } = await params;
    if (user.role === "agent" && user.id !== agentId) throw new HttpError(403, "You don't have permission to do that");
    const body: AgentLedgerEntryDTO[] = await getAgentLedger(prisma, agentId);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
