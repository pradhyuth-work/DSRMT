import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { settleAgent } from "@/lib/agent-issues";
import { settleAgentSchema } from "@/lib/validation";
import type { SettleAgentResponse } from "@/lib/types";

/**
 * Clears units from an agent's holding. Cash received (PAID) can be recorded by admin or stock
 * incharge; a write-off is admin only and needs a reason. Cleared units are priced at the rate
 * they were issued at, oldest issue first.
 */
export async function POST(req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { agentId } = await params;
    const input = await parseBody(req, settleAgentSchema);
    if (input.method === "WRITE_OFF" && user.role !== "admin") throw new HttpError(403, "Only an admin can write units off");
    const body: SettleAgentResponse = await prisma.$transaction((tx) => settleAgent(tx, user, agentId, input), {
      timeout: TRANSACTION_TIMEOUT_MS,
    });
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
