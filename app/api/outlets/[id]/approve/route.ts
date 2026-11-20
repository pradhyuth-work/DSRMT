import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { outletSelect, toOutletDTO } from "@/lib/outlets";

/** Admin approves an outlet that was made at the POS. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin"]);
    const { id } = await params;
    const row = await prisma.outlet.update({ where: { id }, data: { pendingReview: false }, select: outletSelect });
    return NextResponse.json(toOutletDTO(row));
  } catch (err) {
    return errorResponse(err);
  }
}
