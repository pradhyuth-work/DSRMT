-- 0022_pos_and_tax_snapshots.sql
-- POS billing and tax reports. Run after 0021. Safe to re-run (IF NOT EXISTS).
-- Invoice: tax option used, POS flag, place of supply (state code).
-- InvoiceItem: MRP / HSN / GST rate / taxable value / tax saved at billing, so reports never change later.
-- Outlet: a new outlet made at the POS waits for review.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxMode" TEXT NOT NULL DEFAULT 'MRP';
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "posBill" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "placeOfSupply" TEXT NOT NULL DEFAULT '29';

ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "mrp" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "hsnCode" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "gstRate" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "taxable" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "taxAmt" DOUBLE PRECISION;

ALTER TABLE "Outlet" ADD COLUMN IF NOT EXISTS "pendingReview" BOOLEAN NOT NULL DEFAULT false;
