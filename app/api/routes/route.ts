import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { createRouteSchema } from "@/lib/validation";
import { assertValidRouteAgent, routeSelect, toRouteDTO, vacateOtherRoutes } from "@/lib/routes";
import type { RouteDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Lists every route with its assigned agent (if any) and how many outlets are on it. */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const routes = await prisma.route.findMany({ orderBy: { name: "asc" }, select: routeSelect });
    const body: RouteDTO[] = routes.map(toRouteDTO);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const input = await parseBody(req, createRouteSchema);

    const route = await prisma.$transaction(async (tx) => {
      await assertValidRouteAgent(tx, input.agentId);
      if (input.agentId) await vacateOtherRoutes(tx, input.agentId);
      return tx.route.create({ data: { name: input.name, agentId: input.agentId }, select: routeSelect });
    });
    return NextResponse.json(toRouteDTO(route), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
