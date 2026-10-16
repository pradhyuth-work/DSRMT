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

const result = computeSchemeSavings([bill1, bill2, bill3, billNoScheme, cancelled, pending, givenBill]);

let failures = 0;
let total = 0;
function check(label: string, actual: unknown, expected: unknown) {
  total++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures++;
}

check("saved (the headline worked example: 800 + 500 + 250)", result.saved, 1550);
check("billed (10000 + 6500 + 4000 + 1000 no-scheme bill)", result.billed, 21_500);
check("atScheme (billed - saved)", result.atScheme, 21_500 - 1550);
check("given (from the hasScheme=true bill only)", result.given, 1000);
check("net (saved - given)", result.net, 1550 - 1000);
check("pctSaved (saved / billed * 100, rounded)", result.pctSaved, Math.round((1550 / 21_500) * 100 * 100) / 100);
check("billCount (cancelled/pending/given excluded)", result.billCount, 4);
check("noSchemeLines", result.noSchemeLines, 1);
check("estimatedLines", result.estimatedLines, 1);
check(
  "bills list contains exactly the no-scheme bills, not cancelled/pending/given",
  result.bills.map((b) => b.invoiceId).sort(),
  ["bill-1", "bill-2", "bill-3", "bill-no-scheme"].sort(),
);

if (failures > 0) {
  console.error(`\n${failures} of ${total} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${total} checks passed.`);
}
