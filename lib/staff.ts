import type { Prisma } from "@prisma/client";
import type { StaffDTO } from "./types";

/** Never select passwordHash into anything that leaves the server. */
export const staffSelect = {
  id: true,
  name: true,
  phone: true,
  username: true,
  role: true,
  active: true,
  passwordHash: true,
} satisfies Prisma.StaffSelect;

export function toStaffDTO(s: Prisma.StaffGetPayload<{ select: typeof staffSelect }>): StaffDTO {
  return {
    id: s.id,
    name: s.name,
    phone: s.phone,
    username: s.username,
    role: s.role,
    active: s.active,
    canLogin: Boolean(s.username && s.passwordHash),
  };
}
