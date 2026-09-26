import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import type { StaffDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const staff: StaffDTO[] = await prisma.staff.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    });
    return NextResponse.json(staff);
  } catch (err) {
    return errorResponse(err);
  }
}
