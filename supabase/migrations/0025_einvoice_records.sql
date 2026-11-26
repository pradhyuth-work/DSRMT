-- 0025_einvoice_records.sql
-- IRN / e-way bill records made through the GSP (gstinapi.in). Run after 0024. Safe to re-run.
-- One row per invoice number per mode (test / live): the unique index is what stops the same bill
-- being sent twice. A new table only; nothing existing is changed.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS "EInvoice" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "docNo" TEXT NOT NULL,
  "testMode" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL,
  "irn" TEXT,
  "ackNo" TEXT,
  "ackDate" TEXT,
  "qrImage" TEXT,
  "signedInvoice" TEXT,
  "ewbStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  "ewbNo" TEXT,
  "ewbDate" TEXT,
  "ewbValidUpto" TEXT,
  "ewbError" TEXT,
  "vehicleNo" TEXT,
  "error" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EInvoice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "EInvoice_docNo_testMode_key" ON "EInvoice"("docNo", "testMode");
CREATE INDEX IF NOT EXISTS "EInvoice_invoiceId_idx" ON "EInvoice"("invoiceId");

-- Same lock-down as every other table: only the app's server connection reads it.
ALTER TABLE "EInvoice" ENABLE ROW LEVEL SECURITY;
