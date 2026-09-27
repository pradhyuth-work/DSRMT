-- 0006_billing_stage_and_payment_methods.sql
-- Two independent, additive changes. Run after 0005.
--
-- 1) A "Billed" stage between an order being placed and it being dispatched. A physical
--    bill-book number is now entered by hand (POST /api/orders/:id/bill) instead of being
--    auto-generated at order creation — invoiceNumber starts NULL and dispatch is blocked
--    until it's set. Existing DISPATCHED/CANCELLED invoices already went through the old
--    auto-numbering scheme, so they're backfilled with their existing id as invoiceNumber
--    (nothing to re-enter for history that's already settled). Existing PENDING invoices
--    are left unbilled — they now need a bill number before they can be dispatched, same
--    as any new order.
--
-- 2) Payment methods gain CHEQUE and NET_BANKING. UPI stays in the enum (Postgres can't
--    drop an enum value, and doing so would orphan any historical UPI payment row) but the
--    app no longer offers it when recording a new payment.
--
-- Both ALTER TYPE ... ADD VALUE calls are safe inside a transaction on Postgres 12+
-- (Supabase runs a newer version), and neither new value is used elsewhere in this file.

BEGIN;

ALTER TYPE "FulfilmentStatus" ADD VALUE IF NOT EXISTS 'BILLED' BEFORE 'DISPATCHED';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CHEQUE';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'NET_BANKING';

ALTER TABLE "Invoice"
  ADD COLUMN "invoiceNumber" TEXT,
  ADD COLUMN "billedAt" TIMESTAMP(3),
  ADD COLUMN "billedById" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billedById_fkey"
  FOREIGN KEY ("billedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Invoice" SET "invoiceNumber" = "id" WHERE "fulfilmentStatus" <> 'PENDING' AND "invoiceNumber" IS NULL;

COMMIT;
