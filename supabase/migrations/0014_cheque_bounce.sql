-- 0014_cheque_bounce.sql
-- Cheque bounce / reflect-again. Run after 0013.
--
-- PaymentCollection.chequeGroupId: ties together the rows of ONE physical cheque (a cheque
-- that settles several invoices is stored as several rows). Bounce and reflect-again act on
-- the whole group. Back-filled below: cheques with a number are grouped by
-- (outlet, cheque number, cheque date); a CHEQUE row with no number (e.g. taken at the time
-- of sale) becomes a group of its own. The id is a deterministic md5, so re-running is safe.
--
-- PaymentCollection.chequeStatus: ACTIVE (counts as received — every existing row) or
-- BOUNCED (does not count; the invoices it settled are open again). Rows are never deleted.
--
-- ChequeEvent: the history of every bounce / reflect-again, with who, when, the optional
-- reason and the bounce fee charged. Nothing existing is dropped, renamed or rewritten.
-- Runs in one transaction.

BEGIN;

CREATE TYPE "ChequeStatus" AS ENUM ('ACTIVE', 'BOUNCED');

ALTER TABLE "PaymentCollection" ADD COLUMN "chequeGroupId" TEXT;
ALTER TABLE "PaymentCollection" ADD COLUMN "chequeStatus" "ChequeStatus" NOT NULL DEFAULT 'ACTIVE';

UPDATE "PaymentCollection"
SET "chequeGroupId" = md5(concat_ws('|', "outletId", "chequeNumber", COALESCE("chequeDate"::text, '')))
WHERE "paymentMethod" = 'CHEQUE' AND "chequeNumber" IS NOT NULL AND "chequeGroupId" IS NULL;

UPDATE "PaymentCollection"
SET "chequeGroupId" = md5("id")
WHERE "paymentMethod" = 'CHEQUE' AND "chequeNumber" IS NULL AND "chequeGroupId" IS NULL;

CREATE INDEX "PaymentCollection_chequeGroupId_idx" ON "PaymentCollection"("chequeGroupId");

CREATE TABLE "ChequeEvent" (
  "id" TEXT NOT NULL,
  "chequeGroupId" TEXT NOT NULL,
  "outletId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "amount" DOUBLE PRECISION NOT NULL,
  "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "staffId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChequeEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChequeEvent_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ChequeEvent_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ChequeEvent_chequeGroupId_createdAt_idx" ON "ChequeEvent"("chequeGroupId", "createdAt");
CREATE INDEX "ChequeEvent_outletId_idx" ON "ChequeEvent"("outletId");

COMMIT;
