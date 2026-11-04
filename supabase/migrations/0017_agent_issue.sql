-- 0017_agent_issue.sql
-- Agent Issue: stock given to a field agent without billing any outlet (for example to cover
-- a missed target). Targets are tracked outside the app, so nothing here knows about them.
-- Run after 0016.
--
-- AgentIssue / AgentIssueItem: one issue per hand-over. Each line freezes the product's
-- billing rate (Product.unitPrice, tax already inside) at the moment of issue. settledQty is
-- how much of the line has been cleared so far, oldest issue first; what the agent still owes
-- is the sum of (quantity - settledQty) * unitPrice. Rows are never deleted.
--
-- AgentSettlement: every time units are cleared, by cash received (PAID) or by an admin
-- write-off (WRITE_OFF). amount is what the cleared units were worth at their issue rates.
--
-- Nothing existing is dropped, renamed or rewritten. Runs in one transaction.

BEGIN;

CREATE TYPE "AgentSettlementType" AS ENUM ('PAID', 'WRITE_OFF');

CREATE TABLE "AgentIssue" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "note" TEXT,
  "totalAmount" DOUBLE PRECISION NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentIssue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentIssue_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentIssue_number_key" ON "AgentIssue"("number");
CREATE INDEX "AgentIssue_agentId_createdAt_idx" ON "AgentIssue"("agentId", "createdAt");

CREATE TABLE "AgentIssueItem" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DOUBLE PRECISION NOT NULL,
  "subtotal" DOUBLE PRECISION NOT NULL,
  "settledQty" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AgentIssueItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentIssueItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "AgentIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentIssueItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentIssueItem_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "AgentIssueItem_settled_in_range" CHECK ("settledQty" >= 0 AND "settledQty" <= "quantity")
);

CREATE INDEX "AgentIssueItem_issueId_idx" ON "AgentIssueItem"("issueId");
CREATE INDEX "AgentIssueItem_productId_idx" ON "AgentIssueItem"("productId");

CREATE TABLE "AgentSettlement" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "type" "AgentSettlementType" NOT NULL,
  "reason" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentSettlement_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentSettlement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentSettlement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentSettlement_quantity_positive" CHECK ("quantity" > 0)
);

CREATE INDEX "AgentSettlement_agentId_createdAt_idx" ON "AgentSettlement"("agentId", "createdAt");

-- Same as the baseline tables: the app connects as the table owner (bypasses RLS); enabling it
-- with no policies blocks anything that reaches these tables through Supabase's public API.
ALTER TABLE "AgentIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentIssueItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentSettlement" ENABLE ROW LEVEL SECURITY;

COMMIT;
