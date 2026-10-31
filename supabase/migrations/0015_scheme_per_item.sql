-- 0015_scheme_per_item.sql
-- Moves the scheme-pricing toggle from the whole order down to each line item, so a single
-- order can mix scheme and normal lines. Run after 0014.
--
-- InvoiceItem.hasScheme: whether this line is currently priced with scheme rates. Backfilled
-- from the order's old hasScheme flag so existing orders keep the same effective pricing.
--
-- Runs in one transaction.

BEGIN;

ALTER TABLE "InvoiceItem" ADD COLUMN "hasScheme" BOOLEAN NOT NULL DEFAULT false;

UPDATE "InvoiceItem" ii
SET "hasScheme" = true
FROM "Invoice" i
WHERE i."id" = ii."invoiceId" AND i."hasScheme" = true;

ALTER TABLE "Invoice" DROP COLUMN "hasScheme";

COMMIT;
