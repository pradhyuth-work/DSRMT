-- 0019_scheme_savings_vs_scheme_price.sql
-- Scheme Savings now compares Invoice.totalAmount (what was actually entered at billing)
-- against what the bill would total if every line were priced at the product's scheme rate
-- ("what it would be if given at scheme") — not against the full/non-scheme price. The old
-- comparison (full price vs entered amount, from 0018) showed zero for bills billed at exactly
-- full price even when a scheme was available and simply never applied; this one surfaces
-- that as the "savings" the outlet missed out on (or, if negative, an ad hoc discount beyond
-- what any scheme sanctions). Run after 0018.
--
-- InvoiceItem.schemeUnitPrice: the product's scheme (promotional) unitPrice at the moment
-- this order was billed — captured once, going forward, by POST /api/orders/:id/bill, for
-- every line (scheme or not), same as listUnitPrice. Null when the product had no active
-- scheme price at billing time, in which case Scheme Savings falls back to that line's
-- listUnitPrice (no discount sanctioned).
--
-- InvoiceItem.schemePriceEstimated: true for lines back-filled by this migration from the
-- product's *current* scheme price rather than captured live at billing — the scheme price
-- (or whether one was even active) at billing time may have been different.
--
-- Runs in one transaction; nothing else is touched.

BEGIN;

ALTER TABLE "InvoiceItem" ADD COLUMN "schemeUnitPrice" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "schemePriceEstimated" BOOLEAN NOT NULL DEFAULT false;

-- Backfill every already-billed/dispatched line from the product's current scheme price —
-- only when one is actually set and active; otherwise schemeUnitPrice stays NULL (no scheme
-- to estimate, so schemePriceEstimated stays false too).
UPDATE "InvoiceItem" ii
SET "schemeUnitPrice" = p."schemePrice",
    "schemePriceEstimated" = true
FROM "Invoice" inv, "Product" p
WHERE ii."invoiceId" = inv."id"
  AND ii."productId" = p."id"
  AND inv."fulfilmentStatus" IN ('BILLED', 'DISPATCHED')
  AND ii."schemeUnitPrice" IS NULL
  AND p."schemeActive" = true
  AND p."schemePrice" IS NOT NULL;

COMMIT;
