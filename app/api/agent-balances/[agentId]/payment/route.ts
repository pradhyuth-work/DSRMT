import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { recordAgentPayment } from "@/lib/agent-issues";
import { recordAgentPaymentSchema } from "@/lib/validation";
import type { RecordAgentPaymentResponse } from "@/lib/types";

/**
 * Records money received from a field agent as any amount the admin or stock incharge types.
 * It is not calculated against items and clears no units; it just comes off what the agent owes.
 */
export async function POST(req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { agentId } = await params;
    const input = await parseBody(req, recordAgentPaymentSchema);
    const body: RecordAgentPaymentResponse = await prisma.$transaction((tx) => recordAgentPayment(tx, user, agentId, input), {
      timeout: TRANSACTION_TIMEOUT_MS,
    });
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
