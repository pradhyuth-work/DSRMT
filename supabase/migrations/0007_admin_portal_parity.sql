-- 0007_admin_portal_parity.sql
-- Adds the outlet visibility toggle. Run after 0006.
--
-- Everything else in this phase (deleting an unused outlet/product, a payment
-- reversal, a bulk product-rate update, and the full-data backup download) is
-- pure application logic against existing tables/columns — nothing else to add here.

BEGIN;

ALTER TABLE "Outlet" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
