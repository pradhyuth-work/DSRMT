import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { ALL_ROLES, authorize } from "@/lib/auth";
import { outletSelect, toOutletDTO } from "@/lib/outlets";
import type { OutletDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Lists outlets. Agents only ever see outlets on their route (an outlet on no route, or
 * on a route with no agent, is invisible to every agent until an admin sorts it out) —
 * this is what the order form's outlet dropdown draws from. Admin and stock see every
 * outlet, routed or not.
 */
export async function GET(req: Request) {
  try {
    const user = await authorize(req, ALL_ROLES);
    const outlets = await prisma.outlet.findMany({
      where: user.role === "agent" ? { route: { agentId: user.id } } : undefined,
      orderBy: { name: "asc" },
      select: outletSelect,
    });
    const body: OutletDTO[] = outlets.map(toOutletDTO);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

