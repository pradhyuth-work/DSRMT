import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { updateOutletSchema } from "@/lib/validation";
import { outletSelect, toOutletDTO } from "@/lib/outlets";

/** Edit an outlet's details or (re)assign its field agent. Admin only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin"]);
    const { id } = await params;
    const input = await parseBody(req, updateOutletSchema);

    const exists = await prisma.outlet.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "Outlet not found");

    if (input.agentId) {
      const agent = await prisma.staff.findUnique({ where: { id: input.agentId }, select: { role: true } });
      if (!agent) throw new HttpError(400, "Agent not found");
      if (agent.role !== "agent") throw new HttpError(400, "Only a field agent can be assigned to an outlet");
    }

    const outlet = await prisma.outlet.update({
      where: { id },
      data: { name: input.name, phone: input.phone, agentId: input.agentId },
      select: outletSelect,
    });
    return NextResponse.json(toOutletDTO(outlet));
  } catch (err) {
    return errorResponse(err);
  }
}
