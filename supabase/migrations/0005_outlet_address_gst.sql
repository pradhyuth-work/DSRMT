-- 0005_outlet_address_gst.sql
-- Adds address and GST number to Outlet. Both are additive and safe on existing data:
-- address defaults to an empty string (never null, so existing code that reads it doesn't
-- need extra null-checks), gstNumber is nullable (most existing outlets won't have one on
-- file yet — fill it in from the Outlet Ledgers tab).
--
-- Runs in one transaction.

BEGIN;

ALTER TABLE "Outlet"
  ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "gstNumber" TEXT;

COMMIT;
