import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_TIMEOUT_MS, errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { reflectCheque } from "@/lib/cheques";

/**
 * Reflects a bounced cheque again (re-presented and cleared): the money is applied to the
 * invoices again and the balance drops. Admin and stock incharge. See lib/cheques.ts.
 */
export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { groupId } = await params;
    const body = await prisma.$transaction((tx) => reflectCheque(tx, groupId, user), { timeout: TRANSACTION_TIMEOUT_MS });
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
