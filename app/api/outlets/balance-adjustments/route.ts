import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { balanceAdjustmentSelect, toBalanceAdjustmentDTO } from "@/lib/balance-adjustments";
import type { BalanceAdjustmentDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIMIT = 200;

/** Recent manual ledger-balance corrections, newest first. Admin only. */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const rows = await prisma.balanceAdjustment.findMany({
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: balanceAdjustmentSelect,
    });
    const body: BalanceAdjustmentDTO[] = rows.map(toBalanceAdjustmentDTO);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
