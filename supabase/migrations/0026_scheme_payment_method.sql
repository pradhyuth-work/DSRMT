-- 0026_scheme_payment_method.sql
-- Adds SCHEME as a selectable payment method — same additive pattern as 0011's VOUCHER
-- addition. Safe inside a transaction on Postgres 12+ (Supabase runs a newer version), and
-- the new value isn't used elsewhere in this file.
--
-- Settles an outlet's balance via a scheme credit rather than a cash-equivalent instrument.
-- Scheme Savings (lib/scheme-savings.ts) only ever reads Invoice/InvoiceItem, never
-- PaymentCollection, so amounts recorded under this method never affect it.

BEGIN;

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'SCHEME';

COMMIT;
