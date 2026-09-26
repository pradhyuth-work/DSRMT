import type { Prisma } from "@prisma/client";
import type { OutletDTO } from "./types";

export const outletSelect = {
  id: true,
  name: true,
  phone: true,
  address: true,
  gstNumber: true,
  routeId: true,
  route: { select: { name: true, agentId: true, agent: { select: { name: true } } } },
} satisfies Prisma.OutletSelect;

export function toOutletDTO(o: Prisma.OutletGetPayload<{ select: typeof outletSelect }>): OutletDTO {
  return {
    id: o.id,
    name: o.name,
    phone: o.phone,
    address: o.address,
    gstNumber: o.gstNumber,
    routeId: o.routeId,
    routeName: o.route?.name ?? null,
    // Derived from the route for convenience — every enforcement/filter check that used
    // to read the outlet's own agent reads this instead, unchanged.
    agentId: o.route?.agentId ?? null,
    agentName: o.route?.agent?.name ?? null,
  };
}
