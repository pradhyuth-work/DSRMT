import type { Prisma } from "@prisma/client";
import type { OutletDTO } from "./types";

export const outletSelect = {
  id: true,
  name: true,
  phone: true,
  agentId: true,
  agent: { select: { name: true } },
} satisfies Prisma.OutletSelect;

export function toOutletDTO(o: Prisma.OutletGetPayload<{ select: typeof outletSelect }>): OutletDTO {
  return { id: o.id, name: o.name, phone: o.phone, agentId: o.agentId, agentName: o.agent?.name ?? null };
}
