-- 0012_scheme_savings.sql
-- Adds the data Scheme Savings needs. Run after 0011.
--
-- InvoiceItem.schemeUnitPrice: the product's scheme price (Product.schemePrice, only when
-- Product.schemeActive) at the moment this order was billed — captured once, going forward,
-- by POST /api/orders/:id/bill. NULL means no scheme price was set/active at billing time
-- (or the order predates this column and wasn't back-filled below).
--
-- InvoiceItem.schemeEstimated: true for lines back-filled by this migration from the
-- product's *current* scheme price rather than captured live at billing — the price at
-- billing time may have been different, so these are estimates, not exact history.
--
-- The one-off back-fill below only touches BILLED/DISPATCHED invoices (PENDING orders will
-- get a real snapshot when they're billed; CANCELLED ones are never counted in Scheme
-- Savings) and only lines whose product currently has an active scheme price — the same
-- "set and switched on" rule lib/products.ts#effectiveSchemePrice applies everywhere else.
--
-- It also requires schemePrice <= the line's own (historical, frozen) unitPrice. A scheme
-- price is a discount, so it should never exceed what was actually charged — if today's
-- schemePrice is higher than that, prices have clearly moved since billing and guessing
-- would produce a nonsensical negative "saved" for that line, not a real estimate. Left
-- NULL (no scheme price captured) instead, same as a product with no scheme at all.
--
-- Nothing existing is dropped, renamed or rewritten. Runs in one transaction.

BEGIN;

ALTER TABLE "InvoiceItem" ADD COLUMN "schemeUnitPrice" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "schemeEstimated" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: for already-billed/dispatched lines with no snapshot yet, estimate it from the
-- product's current scheme price — only when that price is set, currently active, and no
-- higher than what this line was actually billed at (see the note above).
UPDATE "InvoiceItem" ii
SET "schemeUnitPrice" = p."schemePrice",
    "schemeEstimated" = true
FROM "Invoice" inv, "Product" p
WHERE ii."invoiceId" = inv."id"
  AND ii."productId" = p."id"
  AND inv."fulfilmentStatus" IN ('BILLED', 'DISPATCHED')
  AND p."schemePrice" IS NOT NULL
  AND p."schemeActive" = true
  AND p."schemePrice" <= ii."unitPrice"
  AND ii."schemeUnitPrice" IS NULL;

COMMIT;
