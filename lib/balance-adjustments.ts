import type { Prisma } from "@prisma/client";
import type { BalanceAdjustmentDTO, BalanceAdjustmentMode } from "./types";

export const balanceAdjustmentSelect = {
  id: true,
  outletId: true,
  oldBalance: true,
  newBalance: true,
  delta: true,
  mode: true,
  reason: true,
  createdAt: true,
  outlet: { select: { name: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.BalanceAdjustmentSelect;

export function toBalanceAdjustmentDTO(
  row: Prisma.BalanceAdjustmentGetPayload<{ select: typeof balanceAdjustmentSelect }>,
): BalanceAdjustmentDTO {
  return {
    id: row.id,
    outletId: row.outletId,
    outletName: row.outlet.name,
    oldBalance: row.oldBalance,
    newBalance: row.newBalance,
    delta: row.delta,
    mode: row.mode as BalanceAdjustmentMode,
    reason: row.reason,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt.toISOString(),
  };
}
