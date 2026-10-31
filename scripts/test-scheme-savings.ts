// Fixture-based check of computeSchemeSavings — no database involved.
// Usage: npx tsx scripts/test-scheme-savings.ts
import { computeSchemeSavings, type SchemeSavingsInvoiceInput } from "../lib/scheme-savings";

function bill(
  id: string,
  opts: {
    fulfilmentStatus?: SchemeSavingsInvoiceInput["fulfilmentStatus"];
    hasScheme?: boolean;
    unitPrice: number;
    schemeUnitPrice: number | null;
    quantity?: number;
    schemeEstimated?: boolean;
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
    items: [
      {
        productId: "product-1",
        productName: "Test Product",
        quantity,
        unitPrice: opts.unitPrice,
        subtotal: opts.unitPrice * quantity,
        hasScheme: opts.hasScheme ?? false,
        schemeUnitPrice: opts.schemeUnitPrice,
        schemeEstimated: opts.schemeEstimated ?? false,
      },
    ],
  };
}

// A single invoice with two lines, one scheme and one not — the point of the per-SKU
// change: the non-scheme line counts toward saved/billed/the bill row, the scheme line
// only toward given, and both live on the same invoiceId.
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
    items: [
      {
        productId: "product-1",
        productName: "No-scheme line",
        quantity: 1,
        unitPrice: 1_000,
        subtotal: 1_000,
        hasScheme: false,
        schemeUnitPrice: 900,
        schemeEstimated: false,
      },
      {
        productId: "product-2",
        productName: "Scheme line",
        quantity: 1,
        unitPrice: 2_000,
        subtotal: 2_000,
        hasScheme: true,
        schemeUnitPrice: 1_700,
        schemeEstimated: false,
      },
    ],
  };
}

// The three worked-example bills: billed 10,000 / 6,500 / 4,000, at-scheme 9,200 / 6,000 /
// 3,750 → saved 800 + 500 + 250 = 1,550.
const bill1 = bill("bill-1", { unitPrice: 10_000, schemeUnitPrice: 9_200 });
const bill2 = bill("bill-2", { unitPrice: 6_500, schemeUnitPrice: 6_000, schemeEstimated: true });
const bill3 = bill("bill-3", { fulfilmentStatus: "DISPATCHED", unitPrice: 4_000, schemeUnitPrice: 3_750 });

// A line with no scheme price at all — contributes to billed, not to saved; counted in noSchemeLines.
const billNoScheme = bill("bill-no-scheme", { unitPrice: 500, schemeUnitPrice: null, quantity: 2 });

// Excluded entirely: wrong fulfilmentStatus. Numbers chosen so they'd be obviously wrong if counted.
const cancelled = bill("bill-cancelled", { fulfilmentStatus: "CANCELLED", unitPrice: 5_000, schemeUnitPrice: 4_000 });
const pending = bill("bill-pending", { fulfilmentStatus: "PENDING", unitPrice: 5_000, schemeUnitPrice: 4_000 });

// hasScheme = true: goes to `given`, not `saved`/`billed`/the bills list.
const givenBill = bill("bill-given", { hasScheme: true, unitPrice: 8_000, schemeUnitPrice: 7_000 });

// An *estimated* scheme price higher than what was actually billed — e.g. a product that
// had an active scheme last month but not this one, so the back-fill guessed from today's
// (different) scheme price. This must NOT produce a negative "saved": it's discarded
// exactly like no scheme price was captured, contributing to billed/noSchemeLines only.
const billBadEstimate = bill("bill-bad-estimate", { unitPrice: 2_000, schemeUnitPrice: 2_500, schemeEstimated: true });

const mixed = mixedBill("bill-mixed");

const result = computeSchemeSavings([bill1, bill2, bill3, billNoScheme, cancelled, pending, givenBill, billBadEstimate, mixed]);

let failures = 0;
let total = 0;
function check(label: string, actual: unknown, expected: unknown) {
  total++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures++;
}

// bill1 + bill2 + bill3 + billNoScheme + billBadEstimate + mixed's non-scheme line only.
const BILLED = 10_000 + 6_500 + 4_000 + 1_000 + 2_000 + 1_000;
const SAVED = 1550 + 100; // headline 1,550 + mixed's non-scheme line (1,000 - 900)
const GIVEN = 1000 + 300; // bill-given's 1,000 + mixed's scheme line (2,000 - 1,700)

check("saved (the headline worked example plus mixed's non-scheme line)", result.saved, SAVED);
check("billed", result.billed, BILLED);
check("atScheme (billed - saved)", result.atScheme, BILLED - SAVED);
check("given (bill-given plus mixed's scheme line)", result.given, GIVEN);
check("net (saved - given)", result.net, SAVED - GIVEN);
check("pctSaved (saved / billed * 100, rounded)", result.pctSaved, Math.round((SAVED / BILLED) * 100 * 100) / 100);
check("billCount (cancelled/pending/given excluded; mixed counted once for its non-scheme line)", result.billCount, 6);
check("noSchemeLines (the null one + the discarded bad estimate)", result.noSchemeLines, 2);
check("estimatedLines (only the genuinely-used estimate)", result.estimatedLines, 1);
check(
  "bills list contains exactly the bills with at least one no-scheme line, not cancelled/pending/pure-given",
  result.bills.map((b) => b.invoiceId).sort(),
  ["bill-1", "bill-2", "bill-3", "bill-no-scheme", "bill-bad-estimate", "bill-mixed"].sort(),
);

const mixedBillResult = result.bills.find((b) => b.invoiceId === "bill-mixed");
check("mixed bill: only its non-scheme line is listed", mixedBillResult?.items.map((i) => i.productId), ["product-1"]);
check("mixed bill: billedAmount is the non-scheme line's subtotal only", mixedBillResult?.billedAmount, 1_000);
check("mixed bill: saved is the non-scheme line's saving only", mixedBillResult?.saved, 100);

const badEstimateBill = result.bills.find((b) => b.invoiceId === "bill-bad-estimate");
check("bad-estimate bill: saved is 0, not negative", badEstimateBill?.saved, 0);
check("bad-estimate bill: atScheme falls back to billedAmount", badEstimateBill?.atScheme, badEstimateBill?.billedAmount);
check("bad-estimate bill: line's schemeUnitPrice is discarded to null", badEstimateBill?.items[0]?.schemeUnitPrice, null);
check("bad-estimate bill: line's schemeEstimated flag is cleared", badEstimateBill?.items[0]?.schemeEstimated, false);

if (failures > 0) {
  console.error(`\n${failures} of ${total} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${total} checks passed.`);
}
