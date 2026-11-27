-- Optional "ship to" address on an invoice, for when goods go somewhere other than the buyer's registered address.
SET statement_timeout = 0;
SET lock_timeout = 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "shipToName" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "shipToAddress" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "shipToCity" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "shipToPincode" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "shipToState" TEXT;
