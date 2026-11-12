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

// A single invoice with two lines — one product with no scheme available at all and one with
// a scheme — billed 300 above the combined scheme total. The point of the per-line split: the
// no-scheme line has nothing to miss and carries none of the saving, however large its own
// full-price weight is; the scheme-eligible line absorbs the entire 300 on its own.
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

// The real-world bug report: every line billed at exactly its own full price (no per-line
// discount anywhere, hasScheme never toggled), but two of the four products currently have an
// active scheme the bill never used. The gap (68) belongs entirely to those two lines, split
// by their own scheme-gap weight — the two lines with no scheme at all (200 and 150, bigger
// than either scheme line on their own) must show 0, not a slice of 68 just for being large.
function fourLineBill(id: string): SchemeSavingsInvoiceInput {
  return {
    id,
    invoiceNumber: id,
    billedAt: new Date("2026-01-15T10:00:00.000Z"),
    fulfilmentStatus: "BILLED",
    outletId: "outlet-1",
    outletName: "Test Outlet",
    staffId: "agent-1",
    staffName: "Test Agent",
    totalAmount: 1_154, // 200 + 150 + 444 + 360, billed at exactly full price throughout
    items: [
      { productId: "p-a", productName: "No-scheme A", quantity: 1, unitPrice: 200, listUnitPrice: 200, listPriceEstimated: false, schemeUnitPrice: null, schemePriceEstimated: false },
      { productId: "p-b", productName: "No-scheme B", quantity: 1, unitPrice: 150, listUnitPrice: 150, listPriceEstimated: false, schemeUnitPrice: null, schemePriceEstimated: false },
      { productId: "p-c", productName: "Scheme C", quantity: 1, unitPrice: 444, listUnitPrice: 444, listPriceEstimated: false, schemeUnitPrice: 436, schemePriceEstimated: true },
      { productId: "p-d", productName: "Scheme D", quantity: 1, unitPrice: 360, listUnitPrice: 360, listPriceEstimated: false, schemeUnitPrice: 300, schemePriceEstimated: true },
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
const fourLine = fourLineBill("bill-four-line");

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
  fourLine,
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
const BILLED = 100 + 6_500 + 4_000 + 1_000 + 3_000 + 1_154; // bill1, bill2, bill3, below-scheme, mixed, four-line
const AT_SCHEME = 70 + 5_800 + 3_600 + 900 + 2_700 + 1_086;
const SAVED = 20 + 200 + 150 + -50 + 300 + 68;

check("saved", result.saved, SAVED);
check("billed", result.billed, BILLED);
check("atScheme", result.atScheme, AT_SCHEME);
check("pctSaved (saved / atScheme * 100, rounded)", result.pctSaved, Math.round((SAVED / AT_SCHEME) * 100 * 100) / 100);
check(
  "billCount (honoured/no-saving/cancelled/pending excluded)",
  result.billCount,
  6,
);
check("estimatedLines (bill-2's line, plus bill-four-line's two scheme lines)", result.estimatedLines, 3);
check(
  "bills list excludes the honoured, zero-saving, cancelled and pending bills",
  result.bills.map((b) => b.invoiceId).sort(),
  ["bill-1", "bill-2", "bill-3", "bill-below-scheme", "bill-mixed", "bill-four-line"].sort(),
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
  "mixed bill: the no-scheme line gets none of it, the scheme-eligible line absorbs all of it",
  mixedResult?.items.map((i) => i.saved),
  [0, 300],
);
check("mixed bill: no-scheme line's schemeUnitPrice stays null", mixedResult?.items[0]?.schemeUnitPrice, null);

const fourLineResult = result.bills.find((b) => b.invoiceId === "bill-four-line");
check("four-line bill: saved is the full bill-level gap", fourLineResult?.saved, 68);
check(
  "four-line bill: the two no-scheme lines (A, B) get 0 even though they're the biggest lines; C/D split 68 by their own scheme weight (436/736 and 300/736)",
  fourLineResult?.items.map((i) => i.saved),
  [0, 0, 40.28, 27.72],
);

if (failures > 0) {
  console.error(`\n${failures} of ${total} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${total} checks passed.`);
}
