import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import type { ChequeEventDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Every bounce and reflect-again of one cheque, newest first — who, when, why. Admin and stock. */
export async function GET(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    await authorize(req, ["admin", "stock"]);
    const { groupId } = await params;
    const exists = await prisma.paymentCollection.count({ where: { chequeGroupId: groupId } });
    if (exists === 0) throw new HttpError(404, "Cheque not found");
    const events = await prisma.chequeEvent.findMany({
      where: { chequeGroupId: groupId },
      orderBy: { createdAt: "desc" },
      include: { staff: { select: { name: true } } },
    });
    const body: ChequeEventDTO[] = events.map((e) => ({
      id: e.id,
      action: e.action === "BOUNCED" ? "BOUNCED" : "REFLECTED",
      reason: e.reason,
      amount: e.amount,
      fee: e.fee,
      staffName: e.staff.name,
      createdAt: e.createdAt.toISOString(),
    }));
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
