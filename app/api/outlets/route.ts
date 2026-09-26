import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import type { OutletDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const outlets: OutletDTO[] = await prisma.outlet.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    });
    return NextResponse.json(outlets);
  } catch (err) {
    return errorResponse(err);
  }
}
