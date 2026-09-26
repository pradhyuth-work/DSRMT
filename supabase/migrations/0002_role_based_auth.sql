-- 0002_role_based_auth.sql
-- Adds role-based login and the dispatch workflow. Run after 0001.
--
-- This migration only ADDS columns, types, a table and constraints. It does not drop,
-- rename or rewrite existing columns. Existing rows are changed in only two ways:
--   * Staff: existing people get role = 'agent', active = true and no username or
--     password, so they cannot log in until an admin gives them credentials. Create
--     the first admin with `npm run seed-admin`.
--   * Invoice: existing invoices are marked DISPATCHED (dispatchedAt = createdAt),
--     because the old app deducted their stock when they were created. Only orders
--     created from now on start as PENDING and deduct stock when dispatched.
--
-- It runs in a single transaction: if any statement fails, nothing is changed.

BEGIN;

-- Enums ------------------------------------------------------------------------------
CREATE TYPE "Role" AS ENUM ('admin', 'stock', 'agent');
CREATE TYPE "FulfilmentStatus" AS ENUM ('PENDING', 'DISPATCHED', 'CANCELLED');
CREATE TYPE "StockMovementType" AS ENUM ('RECEIVE', 'ADJUST', 'DISPATCH', 'CANCEL_RETURN');

-- Staff becomes the users table --------------------------------------------------------
ALTER TABLE "Staff"
  ADD COLUMN "username"     TEXT,
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "role"         "Role"    NOT NULL DEFAULT 'agent',
  ADD COLUMN "active"       BOOLEAN   NOT NULL DEFAULT true,
  ADD COLUMN "tokenVersion" INTEGER   NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Staff_username_key" ON "Staff"("username");

-- Invoice fulfilment (the owner is the existing "staffId" column) ----------------------
ALTER TABLE "Invoice"
  ADD COLUMN "fulfilmentStatus" "FulfilmentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "dispatchedAt"     TIMESTAMP(3),
  ADD COLUMN "dispatchedById"   TEXT,
  ADD COLUMN "cancelledAt"      TIMESTAMP(3),
  ADD COLUMN "cancelledById"    TEXT;

-- Backfill: every invoice that exists before this migration already had its stock deducted.
UPDATE "Invoice" SET "fulfilmentStatus" = 'DISPATCHED', "dispatchedAt" = "createdAt";

CREATE INDEX "Invoice_fulfilmentStatus_idx" ON "Invoice"("fulfilmentStatus");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_dispatchedById_fkey"
  FOREIGN KEY ("dispatchedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Stock can never go below zero. Fails (and rolls back) if any product is already negative.
ALTER TABLE "Product" ADD CONSTRAINT "Product_stockQty_nonnegative" CHECK ("stockQty" >= 0);

-- Stock movement audit trail -----------------------------------------------------------
CREATE TABLE "StockMovement" (
    "id"        TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "change"    INTEGER NOT NULL,
    "type"      "StockMovementType" NOT NULL,
    "reason"    TEXT,
    "invoiceId" TEXT,
    "staffId"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");
CREATE INDEX "StockMovement_invoiceId_idx" ON "StockMovement"("invoiceId");

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the Supabase Data API locked out (Staff now holds password hashes). Enabling RLS
-- again on a table where it is already on does nothing, so these lines are safe to repeat.
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Outlet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentCollection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;

COMMIT;
