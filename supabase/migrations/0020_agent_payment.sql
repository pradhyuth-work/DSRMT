-- 0020_agent_payment.sql
-- Free-amount payments from a field agent: enter any number, not calculated against items.
-- Run after 0019.
--
-- AgentPayment: money received from an agent. It is NOT tied to products or units; it just
-- reduces what the agent owes (units held x issue rates, minus the sum of these payments).
-- The balance can therefore go below zero if more is paid than is owed. Rows are never
-- edited or deleted.
--
-- Nothing existing is dropped, renamed or rewritten. Runs in one transaction.

BEGIN;

CREATE TABLE "AgentPayment" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentPayment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentPayment_amount_positive" CHECK ("amount" > 0)
);

CREATE INDEX "AgentPayment_agentId_createdAt_idx" ON "AgentPayment"("agentId", "createdAt");

COMMIT;
