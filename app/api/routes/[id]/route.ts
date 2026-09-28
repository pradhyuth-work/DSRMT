import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { updateRouteSchema } from "@/lib/validation";
import { assertValidRouteAgent, routeSelect, toRouteDTO, vacateOtherRoutes } from "@/lib/routes";

/** Rename a route and/or (re)assign its field agent. Admin only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin"]);
    const { id } = await params;
    const input = await parseBody(req, updateRouteSchema);

    const route = await prisma.$transaction(async (tx) => {
      const exists = await tx.route.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new HttpError(404, "Route not found");

      if (input.agentId !== undefined) {
        await assertValidRouteAgent(tx, input.agentId);
        if (input.agentId) await vacateOtherRoutes(tx, input.agentId, id);
      }

      return tx.route.update({
        where: { id },
        data: { name: input.name, agentId: input.agentId },
        select: routeSelect,
      });
    }, { timeout: TRANSACTION_TIMEOUT_MS });
    return NextResponse.json(toRouteDTO(route));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Deletes a route. Refuses if any outlet is still on it — move them first. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin"]);
    const { id } = await params;

    const outletCount = await prisma.outlet.count({ where: { routeId: id } });
    if (outletCount > 0) {
      throw new HttpError(409, `This route still has ${outletCount} outlet${outletCount === 1 ? "" : "s"} on it — move them first`);
    }
    const deleted = await prisma.route.deleteMany({ where: { id } });
    if (deleted.count === 0) throw new HttpError(404, "Route not found");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
