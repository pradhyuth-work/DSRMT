-- 0003_outlet_agents_and_product_codes.sql
-- Two additive changes. Run after 0001 and 0002.
--
--  1. Outlet.agentId — assigns each outlet to one field agent. Existing outlets are left
--     UNASSIGNED (NULL) because there is no reliable source to infer the mapping from; an
--     admin assigns them from the Outlet Ledgers tab. Unassigned outlets don't appear in
--     any agent's outlet list until assigned (an admin can still order for any outlet).
--
--  2. Product.productCode — a human-facing sequential number (#1, #2, ...), separate from
--     the internal id, used for sorting and for matching rows in the new bulk stock-receive
--     upload. Existing products are backfilled in creation order (oldest = #1).
--
-- Nothing existing is dropped, renamed or rewritten. Runs in one transaction.

BEGIN;

-- 1. Outlet -> agent (Staff) -----------------------------------------------------------
ALTER TABLE "Outlet" ADD COLUMN "agentId" TEXT;
CREATE INDEX "Outlet_agentId_idx" ON "Outlet"("agentId");
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Product -> productCode -------------------------------------------------------------
ALTER TABLE "Product" ADD COLUMN "productCode" INTEGER;

-- Backfill: number existing products in creation order, oldest first.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn FROM "Product"
)
UPDATE "Product" p SET "productCode" = numbered.rn FROM numbered WHERE numbered."id" = p."id";

ALTER TABLE "Product" ALTER COLUMN "productCode" SET NOT NULL;
CREATE UNIQUE INDEX "Product_productCode_key" ON "Product"("productCode");

COMMIT;
