-- 0018_scheme_savings_full_price.sql
-- Reworks Scheme Savings to compare what was actually entered on a bill against what it
-- would have totalled at full (non-scheme) price — not a per-line scheme-price snapshot.
-- Run after 0017.
--
-- InvoiceItem.listUnitPrice: the product's regular, non-scheme unitPrice at the moment this
-- order was billed — captured once, going forward, by POST /api/orders/:id/bill, for every
-- line (scheme or not). This is "what it would be if not edited" down to scheme pricing:
-- summed across a bill's lines and compared against Invoice.totalAmount (the bill value
-- actually entered), the difference is that bill's scheme saving.
--
-- InvoiceItem.listPriceEstimated: true for lines back-filled by this migration from the
-- product's *current* unitPrice rather than captured live at billing — the regular price at
-- billing time may have been different (products get repriced), so these are estimates.
--
-- Unlike the old schemeUnitPrice/schemeEstimated columns this replaces, a regular unitPrice
-- always exists (Product.unitPrice is required, never null), so every line gets a real
-- listUnitPrice — there's no "no scheme price set" case to carry forward.
--
-- Runs in one transaction; nothing else is touched.

BEGIN;

ALTER TABLE "InvoiceItem" ADD COLUMN "listUnitPrice" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "listPriceEstimated" BOOLEAN NOT NULL DEFAULT false;

-- Backfill every already-billed/dispatched line from the product's current regular price.
UPDATE "InvoiceItem" ii
SET "listUnitPrice" = p."unitPrice",
    "listPriceEstimated" = true
FROM "Invoice" inv, "Product" p
WHERE ii."invoiceId" = inv."id"
  AND ii."productId" = p."id"
  AND inv."fulfilmentStatus" IN ('BILLED', 'DISPATCHED')
  AND ii."listUnitPrice" IS NULL;

ALTER TABLE "InvoiceItem" DROP COLUMN "schemeUnitPrice";
ALTER TABLE "InvoiceItem" DROP COLUMN "schemeEstimated";

COMMIT;
