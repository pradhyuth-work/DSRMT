import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import type { RouteDTO } from "./types";

export const routeSelect = {
  id: true,
  name: true,
  agentId: true,
  agent: { select: { name: true } },
  _count: { select: { outlets: true } },
} satisfies Prisma.RouteSelect;

export function toRouteDTO(r: Prisma.RouteGetPayload<{ select: typeof routeSelect }>): RouteDTO {
  return { id: r.id, name: r.name, agentId: r.agentId, agentName: r.agent?.name ?? null, outletCount: r._count.outlets };
}

/** Throws if agentId is set but isn't an active field agent. */
export async function assertValidRouteAgent(tx: Prisma.TransactionClient, agentId: string | null): Promise<void> {
  if (!agentId) return;
  const agent = await tx.staff.findUnique({ where: { id: agentId }, select: { role: true } });
  if (!agent) throw new HttpError(400, "Agent not found");
  if (agent.role !== "agent") throw new HttpError(400, "Only a field agent can be assigned to a route");
}

/**
 * A field agent is tied to at most one route (Route.agentId is unique), so assigning
 * them to a new route means moving them off whatever route they were already on —
 * automatically, in the same transaction, rather than failing on the unique constraint.
 * `excludeRouteId` skips a route's own current row when updating that same route.
 */
export async function vacateOtherRoutes(
  tx: Prisma.TransactionClient,
  agentId: string,
  excludeRouteId?: string,
): Promise<void> {
  await tx.route.updateMany({
    where: { agentId, ...(excludeRouteId ? { NOT: { id: excludeRouteId } } : {}) },
    data: { agentId: null },
  });
}
