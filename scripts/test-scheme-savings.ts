// Fixture-based check of computeSchemeSavings — no database involved.
// Usage: npx tsx scripts/test-scheme-savings.ts
import { computeSchemeSavings, type SchemeSavingsInvoiceInput } from "../lib/scheme-savings";

function bill(
  id: string,
  opts: {
    fulfilmentStatus?: SchemeSavingsInvoiceInput["fulfilmentStatus"];
    unitPrice: number;
    listUnitPrice: number;
    totalAmount?: number;
    quantity?: number;
    listPriceEstimated?: boolean;
  },
): SchemeSavingsInvoiceInput {
  const quantity = opts.quantity ?? 1;
  return {
    id,
    invoiceNumber: id,
    billedAt: new Date("2026-01-15T10:00:00.000Z"),
    fulfilmentStatus: opts.fulfilmentStatus ?? "BILLED",
    outletId: "outlet-1",
    outletName: "Test Outlet",
    staffId: "agent-1",
    staffName: "Test Agent",
    totalAmount: opts.totalAmount ?? opts.unitPrice * quantity,
    items: [
      {
        productId: "product-1",
        productName: "Test Product",
        quantity,
        unitPrice: opts.unitPrice,
        listUnitPrice: opts.listUnitPrice,
        listPriceEstimated: opts.listPriceEstimated ?? false,
      },
    ],
  };
}

// A single invoice with two lines, one at full price and one at a scheme discount — the
// point of the per-line saved split: each line's saved is its share of the bill's overall
// saving, prorated by its share of the full-price total.
function mixedBill(id: string): SchemeSavingsInvoiceInput {
  return {
    id,
    invoiceNumber: id,
    billedAt: new Date("2026-01-15T10:00:00.000Z"),
    fulfilmentStatus: "BILLED",
    outletId: "outlet-1",
    outletName: "Test Outlet",
    staffId: "agent-1",
    staffName: "Test Agent",
    totalAmount: 2_700, // 1,000 (full-price line) + 1,700 (scheme line, listed at 2,000)
    items: [
      {
        productId: "product-1",
        productName: "Full-price line",
        quantity: 1,
        unitPrice: 1_000,
        listUnitPrice: 1_000,
        listPriceEstimated: false,
      },
      {
        productId: "product-2",
        productName: "Scheme line",
        quantity: 1,
        unitPrice: 1_700,
        listUnitPrice: 2_000,
        listPriceEstimated: false,
      },
    ],
  };
}

// Entered total matches the full-price total exactly on the nose — billed at full price,
// nothing to show. unitPrice == listUnitPrice, totalAmount == unitPrice * quantity.
const billNoSaving = bill("bill-no-saving", { unitPrice: 5_000, listUnitPrice: 5_000 });

// Per-line scheme price lower than entered amount (hand-billed exactly at the natural sum).
const bill1 = bill("bill-1", { unitPrice: 9_200, listUnitPrice: 10_000 });
const bill2 = bill("bill-2", { unitPrice: 6_000, listUnitPrice: 6_500, listPriceEstimated: true });
const bill3 = bill("bill-3", { fulfilmentStatus: "DISPATCHED", unitPrice: 3_750, listUnitPrice: 4_000 });

// Entered at the bill book overrides the natural line sum — this is the MTR171 case: every
// line priced at (or near) its full price individually, but the admin typed in a lower total
// at billing. The saving shows up even though no single line looks discounted.
const billRoundedDown = bill("bill-rounded-down", { unitPrice: 1_000, listUnitPrice: 1_000, totalAmount: 900 });

// Entered total slightly ABOVE the full-price total (rounded up at billing) — a small
// negative "saved", not clamped to 0, since that's genuinely what happened.
const billRoundedUp = bill("bill-rounded-up", { unitPrice: 1_000, listUnitPrice: 1_000, totalAmount: 1_020 });

// Excluded entirely: wrong fulfilmentStatus. Numbers chosen so they'd be obviously wrong if counted.
const cancelled = bill("bill-cancelled", { fulfilmentStatus: "CANCELLED", unitPrice: 4_000, listUnitPrice: 5_000 });
const pending = bill("bill-pending", { fulfilmentStatus: "PENDING", unitPrice: 4_000, listUnitPrice: 5_000 });

const mixed = mixedBill("bill-mixed");

const result = computeSchemeSavings([
  billNoSaving,
  bill1,
  bill2,
  bill3,
  billRoundedDown,
  billRoundedUp,
  cancelled,
  pending,
  mixed,
]);

let failures = 0;
let total = 0;
function check(label: string, actual: unknown, expected: unknown) {
  total++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures++;
}

// billed = sum of full-price totals, but only for bills with a nonzero saving — billNoSaving
// is excluded here too, not just from the bills list, so pctSaved isn't diluted by bills that
// have nothing to do with scheme savings.
const BILLED = 10_000 + 6_500 + 4_000 + 1_000 + 1_000 + 3_000;
const SAVED = 800 + 500 + 250 + 100 + -20 + 300; // bill1/2/3, rounded-down, rounded-up, mixed

check("saved", result.saved, SAVED);
check("billed", result.billed, BILLED);
check("atScheme (billed - saved)", result.atScheme, BILLED - SAVED);
check("pctSaved (saved / billed * 100, rounded)", result.pctSaved, Math.round((SAVED / BILLED) * 100 * 100) / 100);
check(
  "billCount (no-saving/cancelled/pending excluded)",
  result.billCount,
  6,
);
check("estimatedLines (only bill-2's line)", result.estimatedLines, 1);
check(
  "bills list excludes the zero-saving, cancelled and pending bills",
  result.bills.map((b) => b.invoiceId).sort(),
  ["bill-1", "bill-2", "bill-3", "bill-rounded-down", "bill-rounded-up", "bill-mixed"].sort(),
);

const roundedDown = result.bills.find((b) => b.invoiceId === "bill-rounded-down");
check("rounded-down bill: saved is the bill-level adjustment, no line looks discounted on its own", roundedDown?.saved, 100);
check("rounded-down bill: its single line absorbs the whole saving", roundedDown?.items[0]?.saved, 100);

const roundedUp = result.bills.find((b) => b.invoiceId === "bill-rounded-up");
check("rounded-up bill: saved is negative, not clamped to 0", roundedUp?.saved, -20);

const mixedResult = result.bills.find((b) => b.invoiceId === "bill-mixed");
check("mixed bill: both lines listed", mixedResult?.items.map((i) => i.productId).sort(), ["product-1", "product-2"]);
check("mixed bill: saved is the full bill-level saving", mixedResult?.saved, 300);
check(
  "mixed bill: saved is prorated across lines by share of full price (1,000/3,000 and 2,000/3,000 of 300)",
  mixedResult?.items.map((i) => i.saved),
  [100, 200],
);

if (failures > 0) {
  console.error(`\n${failures} of ${total} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${total} checks passed.`);
}
