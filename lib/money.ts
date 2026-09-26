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
