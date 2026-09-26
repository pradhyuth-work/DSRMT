import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { ALL_ROLES, authorize } from "@/lib/auth";
import type { OutletDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await authorize(req, ALL_ROLES);
    const outlets: OutletDTO[] = await prisma.outlet.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    });
    return NextResponse.json(outlets);
  } catch (err) {
    return errorResponse(err);
  }
}
