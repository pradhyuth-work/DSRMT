-- 0012_backfill_billed_stock.sql
-- Run after 0011. Orders that were already BILLED but not yet DISPATCHED when billing became
-- the stock-deduction point have not had their stock taken out (the old flow deducted at
-- dispatch, and dispatch no longer deducts). Deduct it now and record BILL movements so those
-- orders behave like any newly billed order (including stock being returned on cancel).
-- Run this ONCE. Stock may go negative if inventory was never topped up for these orders —
-- review products with stockQty < 0 afterwards and restock/adjust as needed.

BEGIN;

INSERT INTO "StockMovement" ("id", "productId", "change", "type", "reason", "invoiceId", "staffId")
SELECT gen_random_uuid()::text, ii."productId", -SUM(ii."quantity"), 'BILL', 'Backfill: billed before stock moved to billing',
       i."id", COALESCE(i."billedById", i."staffId")
FROM "Invoice" i
JOIN "InvoiceItem" ii ON ii."invoiceId" = i."id"
WHERE i."fulfilmentStatus" = 'BILLED'
GROUP BY i."id", ii."productId", COALESCE(i."billedById", i."staffId");

UPDATE "Product" p
SET "stockQty" = p."stockQty" - d.qty
FROM (
  SELECT ii."productId", SUM(ii."quantity")::int AS qty
  FROM "Invoice" i
  JOIN "InvoiceItem" ii ON ii."invoiceId" = i."id"
  WHERE i."fulfilmentStatus" = 'BILLED'
  GROUP BY ii."productId"
) d
WHERE p."id" = d."productId";

COMMIT;
