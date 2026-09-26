import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { ALL_ROLES, authorize } from "@/lib/auth";
import { createOutletSchema } from "@/lib/validation";
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

export async function POST(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const input = await parseBody(req, createOutletSchema);

    if (input.routeId) {
      const route = await prisma.route.findUnique({ where: { id: input.routeId }, select: { id: true } });
      if (!route) throw new HttpError(400, "Route not found");
    }

    const outlet = await prisma.outlet.create({
      data: { name: input.name, phone: input.phone, routeId: input.routeId },
      select: outletSelect,
    });
    return NextResponse.json(toOutletDTO(outlet), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
