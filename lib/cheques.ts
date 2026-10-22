import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import { CHEQUE_BOUNCE_FEE, formatMoney, round2, statusFor } from "./money";
import type { AuthUser, BounceChequeResponse, PaymentAllocation, ReflectChequeResponse } from "./types";

type Tx = Prisma.TransactionClient;

/**
 * Loads every row of one cheque and locks them (plus the invoices they touch) for the rest
 * of the transaction, so two people clicking Flag bounce / Reflect again at once can't both
 * act on the same state — the second one waits, then sees the new status and is refused.
 * Any admin or stock incharge can act on any cheque.
 */
async function lockCheque(tx: Tx, groupId: string) {
  await tx.$queryRaw`SELECT "id" FROM "PaymentCollection" WHERE "chequeGroupId" = ${groupId} FOR UPDATE`;
  const rows = await tx.paymentCollection.findMany({
    where: { chequeGroupId: groupId, paymentMethod: "CHEQUE" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { invoice: { select: { invoiceNumber: true } } },
  });
  if (rows.length === 0) throw new HttpError(404, "Cheque not found");
  return rows;
}

async function lockInvoices(tx: Tx, outletId: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "Invoice"
    WHERE "outletId" = ${outletId} AND "fulfilmentStatus" <> 'CANCELLED'
    FOR UPDATE`;
}

function chequeLabel(row: { chequeNumber: string | null }): string {
  return row.chequeNumber ? `#${row.chequeNumber}` : "(no number)";
}

/**
 * Flags a cheque as bounced. The cheque stops counting as received: every invoice it settled
 * gets the money added back to balanceDue (and taken off paidAmount), and the rows are marked
 * BOUNCED — never deleted. The bounce fee (CHEQUE_BOUNCE_FEE) is added to the outlet's
 * balance as a manual balance adjustment, and the whole thing is written to ChequeEvent.
 */
export async function bounceCheque(tx: Tx, groupId: string, user: AuthUser, reason?: string): Promise<BounceChequeResponse> {
  const rows = await lockCheque(tx, groupId);
  if (rows.every((r) => r.chequeStatus === "BOUNCED")) throw new HttpError(400, "This cheque is already flagged as bounced");
  if (rows.some((r) => r.chequeStatus === "BOUNCED")) throw new HttpError(409, "This cheque is in an inconsistent state — contact the administrator");

  const outletId = rows[0].outletId;
  // Same lock the balance-correction route takes, so the fee below can't race another correction.
  await tx.$queryRaw`SELECT "id" FROM "Outlet" WHERE "id" = ${outletId} FOR UPDATE`;
  await lockInvoices(tx, outletId);

  const restored: BounceChequeResponse["restored"] = [];
  for (const row of rows) {
    if (!row.invoiceId) continue;
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: row.invoiceId } });
    const paidAmount = round2(inv.paidAmount - row.amount);
    const balanceDue = round2(inv.totalAmount - paidAmount);
    await tx.invoice.update({
      where: { id: inv.id },
      data: { paidAmount, balanceDue, status: statusFor(inv.totalAmount, paidAmount) },
    });
    restored.push({ invoiceId: inv.id, invoiceNumber: row.invoice?.invoiceNumber ?? null, amount: row.amount, balanceDue });
  }
  await tx.paymentCollection.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { chequeStatus: "BOUNCED" } });

  const amount = round2(rows.reduce((s, r) => s + r.amount, 0));

  // The bounce charge: a +fee manual adjustment on the outlet, worked out from the balance as
  // it stands now (after the invoices above were reopened) — same arithmetic as the
  // balance-correction route in "adjust" mode.
  const [invoiceSum, adjustmentSum] = await Promise.all([
    tx.invoice.aggregate({ where: { outletId, fulfilmentStatus: { not: "CANCELLED" } }, _sum: { balanceDue: true } }),
    tx.balanceAdjustment.aggregate({ where: { outletId }, _sum: { delta: true } }),
  ]);
  const oldBalance = round2((invoiceSum._sum.balanceDue ?? 0) + (adjustmentSum._sum.delta ?? 0));
  await tx.balanceAdjustment.create({
    data: {
      outletId,
      oldBalance,
      newBalance: round2(oldBalance + CHEQUE_BOUNCE_FEE),
      delta: CHEQUE_BOUNCE_FEE,
      mode: "adjust",
      reason: `Cheque bounce charge: cheque ${chequeLabel(rows[0])}`,
      createdById: user.id,
    },
  });

  await tx.chequeEvent.create({
    data: { chequeGroupId: groupId, outletId, action: "BOUNCED", reason: reason || null, amount, fee: CHEQUE_BOUNCE_FEE, staffId: user.id },
  });

  return { amount, fee: CHEQUE_BOUNCE_FEE, restored };
}

/**
 * Reflects a bounced cheque again (it was re-presented and cleared, or was flagged by
 * mistake). The money goes back to each row's ORIGINAL invoice first, capped at what that
 * invoice still owes (it may have been paid by other money meanwhile); whatever is left is
 * applied oldest-first to the outlet's other open invoices, the same way a new payment is.
 * Refused if the outlet no longer owes enough to absorb the whole cheque — nothing is ever
 * overpaid. The bounce fee is not refunded.
 */
export async function reflectCheque(tx: Tx, groupId: string, user: AuthUser): Promise<ReflectChequeResponse> {
  const rows = await lockCheque(tx, groupId);
  if (rows.every((r) => r.chequeStatus === "ACTIVE")) throw new HttpError(400, "This cheque is not flagged as bounced");
  if (rows.some((r) => r.chequeStatus === "ACTIVE")) throw new HttpError(409, "This cheque is in an inconsistent state — contact the administrator");

  const outletId = rows[0].outletId;
  await lockInvoices(tx, outletId);
  const invoices = await tx.invoice.findMany({
    where: { outletId, fulfilmentStatus: { not: "CANCELLED" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const byId = new Map(invoices.map((i) => [i.id, i]));

  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const outstanding = round2(invoices.reduce((s, i) => s + i.balanceDue, 0));
  if (outstanding < total) {
    throw new HttpError(
      400,
      `This outlet now owes only ${formatMoney(outstanding)}, which is less than the cheque (${formatMoney(total)}). Reflecting it would overpay.`,
    );
  }

  const touched = new Map<string, PaymentAllocation>();
  const apply = (inv: (typeof invoices)[number], applied: number) => {
    inv.paidAmount = round2(inv.paidAmount + applied);
    inv.balanceDue = round2(inv.totalAmount - inv.paidAmount);
    inv.status = statusFor(inv.totalAmount, inv.paidAmount);
    const prev = touched.get(inv.id);
    touched.set(inv.id, {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      applied: round2((prev?.applied ?? 0) + applied),
      balanceDue: inv.balanceDue,
      status: inv.status,
    });
  };

  // Pass 1: back to each row's original invoice, as far as that invoice still owes.
  let leftover = 0;
  for (const row of rows) {
    const inv = row.invoiceId ? byId.get(row.invoiceId) : undefined;
    const applied = inv ? round2(Math.min(row.amount, inv.balanceDue)) : 0;
    if (inv && applied > 0) apply(inv, applied);
    leftover = round2(leftover + row.amount - applied);
    if (applied >= row.amount) {
      await tx.paymentCollection.update({ where: { id: row.id }, data: { chequeStatus: "ACTIVE" } });
    } else if (applied > 0) {
      await tx.paymentCollection.update({ where: { id: row.id }, data: { chequeStatus: "ACTIVE", amount: applied } });
    } else {
      // Nothing of this row fits its original invoice any more; its share is re-applied
      // below as new rows. The bounce and reflect are both kept in ChequeEvent.
      await tx.paymentCollection.delete({ where: { id: row.id } });
    }
  }

  // Pass 2: whatever didn't fit goes oldest-first to the outlet's other open invoices.
  const template = rows[0];
  for (const inv of invoices) {
    if (leftover <= 0) break;
    if (inv.balanceDue <= 0) continue;
    const applied = round2(Math.min(leftover, inv.balanceDue));
    apply(inv, applied);
    await tx.paymentCollection.create({
      data: {
        outletId,
        staffId: template.staffId,
        invoiceId: inv.id,
        amount: applied,
        paymentMethod: "CHEQUE",
        chequeNumber: template.chequeNumber,
        chequeDate: template.chequeDate,
        chequeGroupId: groupId,
        chequeStatus: "ACTIVE",
        notes: template.notes,
      },
    });
    leftover = round2(leftover - applied);
  }

  for (const inv of invoices) {
    if (!touched.has(inv.id)) continue;
    await tx.invoice.update({ where: { id: inv.id }, data: { paidAmount: inv.paidAmount, balanceDue: inv.balanceDue, status: inv.status } });
  }

  await tx.chequeEvent.create({
    data: { chequeGroupId: groupId, outletId, action: "REFLECTED", amount: total, fee: 0, staffId: user.id },
  });

  return { amount: total, allocations: [...touched.values()] };
}
