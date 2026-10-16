-- 0013_scheme_savings_fix_estimates.sql
-- Retroactively corrects migration 0012's back-fill. Run after 0012.
--
-- 0012 estimated each old line's scheme price from the product's scheme price *as it stood
-- when 0012 ran* — but a product's scheme can be changed or switched off entirely since
-- then (a product that had an active scheme last month and doesn't this month, for
-- example). Where that happened, the guess came out higher than what the line actually
-- billed at, producing a nonsensical negative "saved" in Scheme Savings — a discount can't
-- be larger than the price it discounts.
--
-- This doesn't try to guess better (there's no stored price history to guess from); it
-- just retracts guesses that are provably wrong, back to "no scheme price captured"
-- (NULL), same as a product that never had a scheme. Only touches rows 0012 itself wrote
-- (schemeEstimated = true) — never a live-captured snapshot from POST .../bill, which
-- reflects what was genuinely true at billing time regardless of this check.
--
-- Runs in one transaction.

BEGIN;

UPDATE "InvoiceItem"
SET "schemeUnitPrice" = NULL,
    "schemeEstimated" = false
WHERE "schemeEstimated" = true
  AND "schemeUnitPrice" > "unitPrice";

COMMIT;
