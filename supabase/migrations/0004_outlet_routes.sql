-- 0004_outlet_routes.sql
-- Replaces the direct Outlet -> field agent link added in 0003 with an indirect one
-- through routes: a route groups outlets and is assigned to at most one field agent —
-- and an agent is tied to at most one route in turn (agentId is UNIQUE), so a field
-- agent's whole world is exactly the outlets on that one route, never spread across
-- several. Run after 0003.
--
-- No outlet's agent assignment is lost: every outlet that already had an agentId gets a
-- new route (named "<agent name>'s Route") carrying that same agent, and is moved onto
-- it, before the old column is dropped. Outlets with no agent stay unassigned (routeId
-- NULL) — an admin puts them on a route from the Outlet Ledgers tab. Each agent had at
-- most one route created for them (grouped by agent before inserting), so the new
-- uniqueness constraint holds automatically; nothing here can violate it.
--
-- Runs in one transaction.

BEGIN;

CREATE TABLE "Route" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "agentId"   TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Route_agentId_key" ON "Route"("agentId");
ALTER TABLE "Route" ADD CONSTRAINT "Route_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Outlet" ADD COLUMN "routeId" TEXT;

-- Backfill: one route per agent who already has outlets assigned, id derived
-- deterministically from the agent id (no extension/function dependency).
INSERT INTO "Route" ("id", "name", "agentId")
SELECT 'route_' || s."id", s."name" || '''s Route', s."id"
FROM "Staff" s
WHERE s."id" IN (SELECT DISTINCT "agentId" FROM "Outlet" WHERE "agentId" IS NOT NULL);

UPDATE "Outlet" SET "routeId" = 'route_' || "agentId" WHERE "agentId" IS NOT NULL;

CREATE INDEX "Outlet_routeId_idx" ON "Outlet"("routeId");
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Outlet" DROP CONSTRAINT "Outlet_agentId_fkey";
DROP INDEX "Outlet_agentId_idx";
ALTER TABLE "Outlet" DROP COLUMN "agentId";

ALTER TABLE "Route" ENABLE ROW LEVEL SECURITY;

COMMIT;
