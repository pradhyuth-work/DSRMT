import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { correctBalanceSchema } from "@/lib/validation";
import { round2 } from "@/lib/money";
import { balanceAdjustmentSelect, toBalanceAdjustmentDTO } from "@/lib/balance-adjustments";
import type { BalanceAdjustmentDTO } from "@/lib/types";

/**
 * Manually corrects an outlet's ledger balance. See BalanceAdjustment's doc comment in
 * prisma/schema.prisma for why this writes a new ledger entry instead of editing an
 * invoice — "set" writes an exact target balance, "adjust" applies `value` as a signed
 * delta on top of the balance as of right now. Refused while the outlet has an order in
 * flight (PENDING or BILLED): that order's totals haven't settled yet, so a correction
 * made underneath it would be stale the moment it's billed or dispatched — resolve the
 * order first. Admin only.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin"]);
    const { id } = await params;
    const { mode, value, reason } = await parseBody(req, correctBalanceSchema);

    const adjustment = await prisma.$transaction(async (tx) => {
      // Locks the outlet row for the rest of the transaction, so two concurrent corrections
      // against it can't both read the same "old" balance.
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Outlet" WHERE "id" = ${id} FOR UPDATE`;
      if (rows.length === 0) throw new HttpError(404, "Outlet not found");

      const inFlight = await tx.invoice.count({
        where: { outletId: id, fulfilmentStatus: { in: ["PENDING", "BILLED"] } },
      });
      if (inFlight > 0) {
        throw new HttpError(409, "This outlet has an order in progress — dispatch or cancel it before correcting its balance");
      }

      const [invoiceSum, adjustmentSum] = await Promise.all([
        tx.invoice.aggregate({ where: { outletId: id, fulfilmentStatus: { not: "CANCELLED" } }, _sum: { balanceDue: true } }),
        tx.balanceAdjustment.aggregate({ where: { outletId: id }, _sum: { delta: true } }),
      ]);
      const oldBalance = round2((invoiceSum._sum.balanceDue ?? 0) + (adjustmentSum._sum.delta ?? 0));
      const newBalance = mode === "set" ? round2(value) : round2(oldBalance + value);

      return tx.balanceAdjustment.create({
        data: { outletId: id, oldBalance, newBalance, delta: round2(newBalance - oldBalance), mode, reason, createdById: user.id },
        select: balanceAdjustmentSelect,
      });
    });

    const body: BalanceAdjustmentDTO = toBalanceAdjustmentDTO(adjustment);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
