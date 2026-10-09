-- 0011_stock_movement_bill_type.sql
-- Stock now leaves the inventory when an order is BILLED (POST /api/orders/:id/bill), not when
-- it is dispatched. This adds the BILL movement type used to record that deduction. DISPATCH
-- stays in the enum for historical rows. Run before 0012 (a new enum value can't be used in
-- the same transaction that adds it).

BEGIN;
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'BILL' BEFORE 'CANCEL_RETURN';
COMMIT;
