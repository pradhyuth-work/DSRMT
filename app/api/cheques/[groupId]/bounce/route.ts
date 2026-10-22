import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { bounceCheque } from "@/lib/cheques";
import { bounceChequeSchema } from "@/lib/validation";

/**
 * Flags a cheque as bounced: it stops counting as received, the invoices it settled are open
 * again, and the bounce fee is added to the outlet's balance. Admin and stock incharge — either
 * can act on any cheque. See lib/cheques.ts.
 */
export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { groupId } = await params;
    const { reason } = await parseBody(req, bounceChequeSchema);
    const body = await prisma.$transaction((tx) => bounceCheque(tx, groupId, user, reason), { timeout: TRANSACTION_TIMEOUT_MS });
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
