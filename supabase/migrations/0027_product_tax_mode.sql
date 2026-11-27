-- 0027_product_tax_mode.sql
-- Tax type per product, chosen under Billing -> Set-up: 'MRP' (price has GST, tax worked on the MRP;
-- how every product behaved until now), 'INCLUSIVE' (price has GST) or 'EXCLUSIVE' (GST added on top).

BEGIN;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "taxMode" TEXT NOT NULL DEFAULT 'MRP';

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_taxMode_check";
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxMode_check" CHECK ("taxMode" IN ('MRP', 'INCLUSIVE', 'EXCLUSIVE'));

COMMIT;
