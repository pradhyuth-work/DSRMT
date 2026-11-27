/** Round to 2 decimal places to avoid floating point drift in stored amounts. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

export function formatMoney(value: number): string {
  return inr.format(value);
}

/**
 * An order's total split into basic price and GST, for display (order cards, CSV export). GST is the
 * sum of the lines' tax (worked on MRP, see lib/gst.ts); basic is what is left of the amount charged.
 * Null when any line's tax is unknown (no MRP on the product). Never changes the amount billed.
 */
export function splitOrderGst(total: number, items: { gstAmount: number | null }[]): { basic: number; gst: number } | null {
  if (items.some((i) => i.gstAmount === null)) return null;
  const gst = round2(items.reduce((sum, i) => sum + (i.gstAmount ?? 0), 0));
  return { basic: round2(total - gst), gst };
}

export function statusFor(total: number, paid: number): "PAID" | "PARTIAL" | "UNPAID" {
  if (paid <= 0) return "UNPAID";
  if (round2(total - paid) <= 0) return "PAID";
  return "PARTIAL";
}

/**
 * Whole days elapsed since `since`, floored, never negative. Used for "days of credit" —
 * how long an invoice's balance has been outstanding. Measured from the invoice's
 * `createdAt`, not `billedAt`: the amount is owed (and payable) from the moment the order
 * is created — billing is paperwork, not when the debt starts.
 */
export function daysOutstanding(since: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));
}

/**
 * Thresholds for flagging an outstanding balance as ageing. These are defaults, not a
 * business rule handed down by anyone — pick whatever the business actually wants and
 * change them here (both the dashboard "over X days" stat and every days-of-credit badge
 * read from these two constants).
 */
export const DAYS_WARNING_THRESHOLD = 15;
export const DAYS_CRITICAL_THRESHOLD = 30;

/**
 * Charge added to an outlet's balance every time one of its cheques is flagged as bounced
 * (recorded as a manual balance adjustment). A default, not a rule handed down by anyone —
 * change it here. Reflecting the cheque again does not refund it.
 */
export const CHEQUE_BOUNCE_FEE = 500;
