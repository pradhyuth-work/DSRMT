-- Field agent's delivery vehicle: pre-fills the vehicle number when their orders are billed.
SET statement_timeout = 0;
SET lock_timeout = 0;
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "vehicleNo" TEXT;
