import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { createAgentIssue, listAgentIssues } from "@/lib/agent-issues";
import { createAgentIssueSchema } from "@/lib/validation";
import type { AgentIssueDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Recent Agent Issues, newest first. Admin and stock incharge. Optional ?agentId= to narrow to one agent. */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin", "stock"]);
    const agentId = new URL(req.url).searchParams.get("agentId") || undefined;
    const body: AgentIssueDTO[] = await listAgentIssues(prisma, agentId);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Gives stock to a field agent without billing any outlet. Admin and stock incharge — whoever
 * hands it over records it, no second confirmation. Stock leaves the warehouse and the value
 * (billing rate, tax included) is added to what the agent owes. See lib/agent-issues.ts.
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const input = await parseBody(req, createAgentIssueSchema);
    const body: AgentIssueDTO = await prisma.$transaction((tx) => createAgentIssue(tx, user, input), { timeout: TRANSACTION_TIMEOUT_MS });
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
