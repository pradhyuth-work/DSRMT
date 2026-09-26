import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { updateOutletSchema } from "@/lib/validation";
import { outletSelect, toOutletDTO } from "@/lib/outlets";

/** Edit an outlet's details or move it onto a different route. Admin only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin"]);
    const { id } = await params;
    const input = await parseBody(req, updateOutletSchema);

    const exists = await prisma.outlet.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "Outlet not found");

    if (input.routeId) {
      const route = await prisma.route.findUnique({ where: { id: input.routeId }, select: { id: true } });
      if (!route) throw new HttpError(400, "Route not found");
    }

    const outlet = await prisma.outlet.update({
      where: { id },
      data: { name: input.name, phone: input.phone, address: input.address, gstNumber: input.gstNumber, routeId: input.routeId },
      select: outletSelect,
    });
    return NextResponse.json(toOutletDTO(outlet));
  } catch (err) {
    return errorResponse(err);
  }
}
