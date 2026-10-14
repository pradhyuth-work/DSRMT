-- 0011_voucher_payment_method.sql
-- Adds VOUCHER as a selectable payment method — same additive pattern as 0006's
-- CHEQUE/NET_BANKING addition. Safe inside a transaction on Postgres 12+ (Supabase runs a
-- newer version), and the new value isn't used elsewhere in this file.

BEGIN;

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'VOUCHER';

COMMIT;
