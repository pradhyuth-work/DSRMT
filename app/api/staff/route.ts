import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, parseBody } from "@/lib/api";
import { authorize, hashPassword } from "@/lib/auth";
import { createStaffSchema } from "@/lib/validation";
import { staffSelect, toStaffDTO } from "@/lib/staff";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const staff = await prisma.staff.findMany({ orderBy: { name: "asc" }, select: staffSelect });
    return NextResponse.json(staff.map(toStaffDTO));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Create a login user. There is no public sign-up; only admins can call this. */
export async function POST(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const input = await parseBody(req, createStaffSchema);
    const created = await prisma.staff.create({
      data: {
        name: input.name,
        phone: input.phone,
        username: input.username,
        passwordHash: await hashPassword(input.pin),
        role: input.role,
        active: true,
      },
      select: staffSelect,
    });
    return NextResponse.json(toStaffDTO(created), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
