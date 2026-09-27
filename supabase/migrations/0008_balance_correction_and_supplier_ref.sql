-- 0008_balance_correction_and_supplier_ref.sql
-- Two independent additions. Run after 0007.
--
-- 1) StockMovement.supplierRef: an optional free-text supplier/bill reference, set at the
--    batch level when receiving stock (a single restock, or every row of a bulk upload).
--
-- 2) BalanceAdjustment: a manual admin correction to an outlet's ledger balance. See the
--    model's doc comment in prisma/schema.prisma for why this is its own table rather than
--    a fake zero-item invoice — in short, outlets have no single mutable "balance" column
--    to overwrite (it's derived by summing invoice balances), so a correction is folded
--    into the ledger as its own chronological entry instead (lib/reports.ts).

BEGIN;

ALTER TABLE "StockMovement" ADD COLUMN "supplierRef" TEXT;

-- CreateTable
CREATE TABLE "BalanceAdjustment" (
    "id"          TEXT NOT NULL,
    "outletId"    TEXT NOT NULL,
    "oldBalance"  DOUBLE PRECISION NOT NULL,
    "newBalance"  DOUBLE PRECISION NOT NULL,
    "delta"       DOUBLE PRECISION NOT NULL,
    "mode"        TEXT NOT NULL,
    "reason"      TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalanceAdjustment_outletId_createdAt_idx" ON "BalanceAdjustment"("outletId", "createdAt");

-- AddForeignKey
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_outletId_fkey"
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mirrors the reference DSR app's balance_adjustments.mode CHECK — only these two corrections exist.
ALTER TABLE "BalanceAdjustment" ADD CONSTRAINT "BalanceAdjustment_mode_check" CHECK ("mode" IN ('set', 'adjust'));

COMMIT;
