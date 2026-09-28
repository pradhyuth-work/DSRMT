-- 0009_scheme_pricing.sql
-- Adds scheme pricing. Run after 0008.
--
-- Product.schemePrice: an optional second per-unit price. When an order is toggled to
-- "with scheme", every line reprices off this instead of the normal unitPrice — NULL means
-- no scheme price has been set for that product yet, which blocks the toggle for orders
-- containing it (see PATCH /api/orders/:id/scheme).
--
-- Invoice.hasScheme: whether this order is currently priced with scheme rates. Defaults to
-- false for every existing order (nothing already billed/dispatched is reinterpreted).
--
-- Runs in one transaction.

BEGIN;

ALTER TABLE "Product" ADD COLUMN "schemePrice" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN "hasScheme" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
