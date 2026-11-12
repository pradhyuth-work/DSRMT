// Fixture-based check of computeSchemeSavings — no database involved.
// Usage: npx tsx scripts/test-scheme-savings.ts
import { computeSchemeSavings, type SchemeSavingsInvoiceInput } from "../lib/scheme-savings";

function bill(
  id: string,
  opts: {
    fulfilmentStatus?: SchemeSavingsInvoiceInput["fulfilmentStatus"];
    unitPrice: number;
    listUnitPrice: number;
    schemeUnitPrice: number | null;
    totalAmount?: number;
    quantity?: number;
    listPriceEstimated?: boolean;
    schemePriceEstimated?: boolean;
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
        schemeUnitPrice: opts.schemeUnitPrice,
        schemePriceEstimated: opts.schemePriceEstimated ?? false,
      },
    ],
  };
}

// A single invoice with two lines — one product with no scheme available at all (falls back
// to its own list price, so it can't contribute a "missed scheme" gap on its own) and one
// with a scheme — billed 300 above the combined scheme total. The point of the per-line
// split: each line's saved is its share of the bill's overall saving, prorated by its share
// of the scheme total (not the full-price total).
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
    totalAmount: 3_000, // scheme total is 2,700 (1,000 no-scheme line + 1,700 scheme line); 300 over
    items: [
      {
        productId: "product-1",
        productName: "No-scheme line",
        quantity: 1,
        unitPrice: 1_000,
        listUnitPrice: 1_000,
        listPriceEstimated: false,
        schemeUnitPrice: null,
        schemePriceEstimated: false,
      },
      {
        productId: "product-2",
        productName: "Scheme line",
        quantity: 1,
        unitPrice: 1_900,
        listUnitPrice: 2_000,
        listPriceEstimated: false,
        schemeUnitPrice: 1_700,
        schemePriceEstimated: false,
      },
    ],
  };
}

// No scheme available and billed at exactly full price — nothing to show either way.
const billNoSaving = bill("bill-no-saving", { unitPrice: 5_000, listUnitPrice: 5_000, schemeUnitPrice: null });

// Scheme available, billed manually at exactly the scheme total — scheme fully honoured.
const billSchemeHonoured = bill("bill-scheme-honoured", {
  unitPrice: 8_000,
  listUnitPrice: 10_000,
  schemeUnitPrice: 8_000,
  totalAmount: 8_000,
});

// The user's worked example: list 100, scheme 70, manually entered 90 — billed 20 more than
// the ideal scheme total, i.e. the scheme was available but not (fully) applied.
const bill1 = bill("bill-1", { unitPrice: 90, listUnitPrice: 100, schemeUnitPrice: 70, totalAmount: 90 });

const bill2 = bill("bill-2", {
  unitPrice: 6_000,
  listUnitPrice: 6_500,
  schemeUnitPrice: 5_800,
  totalAmount: 6_000,
  schemePriceEstimated: true,
});
const bill3 = bill("bill-3", {
  fulfilmentStatus: "DISPATCHED",
  unitPrice: 3_750,
  listUnitPrice: 4_000,
  schemeUnitPrice: 3_600,
  totalAmount: 3_750,
});

// Entered below the scheme total — an ad hoc discount beyond what any scheme sanctions, a
// genuinely negative "saved", not clamped to 0.
const billBelowScheme = bill("bill-below-scheme", {
  unitPrice: 850,
  listUnitPrice: 1_000,
  schemeUnitPrice: 900,
  totalAmount: 850,
});

// Excluded entirely: wrong fulfilmentStatus. Numbers chosen so they'd be obviously wrong if counted.
const cancelled = bill("bill-cancelled", { fulfilmentStatus: "CANCELLED", unitPrice: 4_000, listUnitPrice: 5_000, schemeUnitPrice: 4_000, totalAmount: 4_500 });
const pending = bill("bill-pending", { fulfilmentStatus: "PENDING", unitPrice: 4_000, listUnitPrice: 5_000, schemeUnitPrice: 4_000, totalAmount: 4_500 });

const mixed = mixedBill("bill-mixed");

const result = computeSchemeSavings([
  billNoSaving,
  billSchemeHonoured,
  bill1,
  bill2,
  bill3,
  billBelowScheme,
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

// billed = sum of full-price totals; atScheme = sum of scheme totals (falling back to list
// price for no-scheme lines) — both only for bills with a nonzero saving.
const BILLED = 100 + 6_500 + 4_000 + 1_000 + 3_000; // bill1, bill2, bill3, below-scheme, mixed
const AT_SCHEME = 70 + 5_800 + 3_600 + 900 + 2_700;
const SAVED = 20 + 200 + 150 + -50 + 300; // bill1, bill2, bill3, below-scheme, mixed

check("saved", result.saved, SAVED);
check("billed", result.billed, BILLED);
check("atScheme", result.atScheme, AT_SCHEME);
check("pctSaved (saved / atScheme * 100, rounded)", result.pctSaved, Math.round((SAVED / AT_SCHEME) * 100 * 100) / 100);
check(
  "billCount (honoured/no-saving/cancelled/pending excluded)",
  result.billCount,
  5,
);
check("estimatedLines (only bill-2's line)", result.estimatedLines, 1);
check(
  "bills list excludes the honoured, zero-saving, cancelled and pending bills",
  result.bills.map((b) => b.invoiceId).sort(),
  ["bill-1", "bill-2", "bill-3", "bill-below-scheme", "bill-mixed"].sort(),
);

const worked = result.bills.find((b) => b.invoiceId === "bill-1");
check("worked example: saved is manual (90) minus scheme (70)", worked?.saved, 20);

const belowScheme = result.bills.find((b) => b.invoiceId === "bill-below-scheme");
check("below-scheme bill: saved is negative, not clamped to 0", belowScheme?.saved, -50);

const honoured = result.bills.find((b) => b.invoiceId === "bill-scheme-honoured");
check("scheme-honoured bill doesn't appear at all", honoured, undefined);

const mixedResult = result.bills.find((b) => b.invoiceId === "bill-mixed");
check("mixed bill: both lines listed", mixedResult?.items.map((i) => i.productId).sort(), ["product-1", "product-2"]);
check("mixed bill: saved is the full bill-level saving", mixedResult?.saved, 300);
check(
  "mixed bill: saved is prorated across lines by share of scheme total (1,000/2,700 and 1,700/2,700 of 300)",
  mixedResult?.items.map((i) => i.saved),
  [111.11, 188.89],
);
check("mixed bill: no-scheme line's schemeUnitPrice stays null", mixedResult?.items[0]?.schemeUnitPrice, null);

if (failures > 0) {
  console.error(`\n${failures} of ${total} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${total} checks passed.`);
}
