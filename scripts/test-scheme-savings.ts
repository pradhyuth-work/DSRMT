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
    hasScheme: opts.hasScheme ?? false,
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
        schemeUnitPrice: opts.schemeUnitPrice,
        schemeEstimated: opts.schemeEstimated ?? false,
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

const result = computeSchemeSavings([bill1, bill2, bill3, billNoScheme, cancelled, pending, givenBill, billBadEstimate]);

let failures = 0;
let total = 0;
function check(label: string, actual: unknown, expected: unknown) {
  total++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures++;
}

const BILLED = 10_000 + 6_500 + 4_000 + 1_000 + 2_000; // bill1 + bill2 + bill3 + billNoScheme + billBadEstimate

check("saved (the headline worked example: 800 + 500 + 250)", result.saved, 1550);
check("billed", result.billed, BILLED);
check("atScheme (billed - saved)", result.atScheme, BILLED - 1550);
check("given (from the hasScheme=true bill only)", result.given, 1000);
check("net (saved - given)", result.net, 1550 - 1000);
check("pctSaved (saved / billed * 100, rounded)", result.pctSaved, Math.round((1550 / BILLED) * 100 * 100) / 100);
check("billCount (cancelled/pending/given excluded)", result.billCount, 5);
check("noSchemeLines (the null one + the discarded bad estimate)", result.noSchemeLines, 2);
check("estimatedLines (only the genuinely-used estimate)", result.estimatedLines, 1);
check(
  "bills list contains exactly the no-scheme bills, not cancelled/pending/given",
  result.bills.map((b) => b.invoiceId).sort(),
  ["bill-1", "bill-2", "bill-3", "bill-no-scheme", "bill-bad-estimate"].sort(),
);

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
