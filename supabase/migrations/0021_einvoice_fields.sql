-- 0021_einvoice_fields.sql
-- Fields the e-invoice (IRP) JSON needs. Run after 0020.
-- Product: HSN code, GST rate, MRP (for Rule 31D valuation) and unit code.
-- Invoice: billed-outside flag, vehicle number, last JSON export time. AppSetting: invoice number series.
-- Outlet: pincode and city (the IRP rejects a buyer without them).
-- All additive and nullable / defaulted; nothing existing is changed.

BEGIN;

ALTER TABLE "Product" ADD COLUMN "hsnCode" TEXT;
ALTER TABLE "Product" ADD COLUMN "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 40;
ALTER TABLE "Product" ADD COLUMN "mrp" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN "uqc" TEXT NOT NULL DEFAULT 'NOS';

ALTER TABLE "Outlet" ADD COLUMN "pincode" TEXT;
ALTER TABLE "Outlet" ADD COLUMN "city" TEXT;

ALTER TABLE "Invoice" ADD COLUMN "billedOutside" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN "vehicleNo" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "einvExportedAt" TIMESTAMP(3);
-- Every bill that exists today was written in the bill book / Target and copied in by hand.
UPDATE "Invoice" SET "billedOutside" = true WHERE "invoiceNumber" IS NOT NULL;

CREATE TABLE "AppSetting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

COMMIT;
