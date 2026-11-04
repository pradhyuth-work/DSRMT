-- 0016_agent_issue_stock_type.sql
-- Stock handed to a field agent (an Agent Issue) leaves the warehouse and is logged as an
-- AGENT_ISSUE stock movement. This adds that movement type. Run after 0015, and before 0017
-- (a new enum value can't be used in the same transaction that adds it).

BEGIN;
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'AGENT_ISSUE' BEFORE 'CANCEL_RETURN';
COMMIT;
