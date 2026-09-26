import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { updateStaffSchema } from "@/lib/validation";
import { staffSelect, toStaffDTO } from "@/lib/staff";

/** Edit a person's details, role or active flag. Admins cannot disable or demote themselves. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await authorize(req, ["admin"]);
    const { id } = await params;
    const input = await parseBody(req, updateStaffSchema);

    if (id === me.id) {
      if (input.active === false) throw new HttpError(400, "You cannot disable your own account");
      if (input.role !== undefined && input.role !== "admin") {
        throw new HttpError(400, "You cannot change your own role");
      }
    }

    const exists = await prisma.staff.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "User not found");

    const updated = await prisma.staff.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone,
        username: input.username,
        role: input.role,
        active: input.active,
      },
      select: staffSelect,
    });
    return NextResponse.json(toStaffDTO(updated));
  } catch (err) {
    return errorResponse(err);
  }
}
