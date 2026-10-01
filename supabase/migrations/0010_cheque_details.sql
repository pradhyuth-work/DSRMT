-- 0010_cheque_details.sql
-- Cheque payments can now carry several cheques, each with its own serial number and date.
-- Each cheque is stored as its own PaymentCollection row(s) with these two columns set;
-- non-cheque payments leave them NULL. Run after 0009.

BEGIN;

ALTER TABLE "PaymentCollection" ADD COLUMN "chequeNumber" TEXT;
ALTER TABLE "PaymentCollection" ADD COLUMN "chequeDate" TIMESTAMP(3);

COMMIT;
