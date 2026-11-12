import { prisma } from "./prisma";
import type { MtDsrInput } from "./mt-dsr";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The India-time calendar day ("YYYY-MM-DD") an instant falls on. */
function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Longest period the export accepts — each day adds four rows to the WD DSR sheet. */
export const MT_DSR_MAX_DAYS = 93;

export class MtDsrRangeError extends Error {}

/**
 * Reads everything the MT DSR workbook needs for an inclusive period of India calendar days.
 * `from` / `to` carry the picked day in their UTC date part (that is how the date-range
 * filter sends them), so the day is read off with toISOString().
 *
 * - Invoices: billed or dispatched orders, dated by when they were billed. Pending and
 *   cancelled orders are not sales. FA = the outlet's route agent (falls back to the order owner).
 * - Opening stock: today's on-hand stock minus every stock movement since the period began.
 * - Primary: RECEIVE movements (stock inwarded from the company).
 */
export async function loadMtDsrInput(from: Date, to: Date): Promise<MtDsrInput> {
  const fromDay = from.toISOString().slice(0, 10);
  const toDay = to.toISOString().slice(0, 10);
  const start = new Date(`${fromDay}T00:00:00+05:30`);
  const endExclusive = new Date(new Date(`${toDay}T00:00:00+05:30`).getTime() + DAY_MS);
  const days = Math.round((endExclusive.getTime() - start.getTime()) / DAY_MS);
  if (days < 1) throw new MtDsrRangeError("The end date must be on or after the start date");
  if (days > MT_DSR_MAX_DAYS) throw new MtDsrRangeError(`Pick a period of at most ${MT_DSR_MAX_DAYS} days`);

  const [invoices, products, movementsSince] = await Promise.all([
    prisma.invoice.findMany({
      where: { fulfilmentStatus: { in: ["BILLED", "DISPATCHED"] }, billedAt: { gte: start, lt: endExclusive } },
      select: {
        billedAt: true,
        totalAmount: true,
        outlet: { select: { name: true, route: { select: { agent: { select: { name: true } } } } } },
        staff: { select: { name: true } },
        items: { select: { quantity: true, product: { select: { name: true } } } },
      },
    }),
    prisma.product.findMany({ select: { id: true, name: true, stockQty: true } }),
    prisma.stockMovement.findMany({
      where: { createdAt: { gte: start } },
      select: { productId: true, change: true, type: true, createdAt: true },
    }),
  ]);

  const nameById = new Map(products.map((p) => [p.id, p.name]));
  const movedSince = new Map<string, number>();
  const received: MtDsrInput["received"] = [];
  for (const m of movementsSince) {
    movedSince.set(m.productId, (movedSince.get(m.productId) ?? 0) + m.change);
    const name = nameById.get(m.productId);
    if (m.type === "RECEIVE" && name && m.createdAt < endExclusive) {
      received.push({ date: istDay(m.createdAt), productName: name, quantity: m.change });
    }
  }
  const openingStock: Record<string, number> = {};
  for (const p of products) openingStock[p.name] = p.stockQty - (movedSince.get(p.id) ?? 0);

  return {
    from: fromDay,
    to: toDay,
    openingStock,
    received,
    invoices: invoices.map((inv) => ({
      date: istDay(inv.billedAt as Date),
      fa: inv.outlet.route?.agent?.name ?? inv.staff.name,
      outlet: inv.outlet.name,
      amount: inv.totalAmount,
      items: inv.items.map((i) => ({ productName: i.product.name, quantity: i.quantity })),
    })),
  };
}
