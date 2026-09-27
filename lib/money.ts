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
