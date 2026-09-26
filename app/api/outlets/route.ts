import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, parseBody } from "@/lib/api";
import { ALL_ROLES, authorize } from "@/lib/auth";
import { createOutletSchema } from "@/lib/validation";
import { outletSelect, toOutletDTO } from "@/lib/outlets";
import type { OutletDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Lists outlets. Agents only ever see outlets assigned to them (an unassigned outlet is
 * invisible to every agent until an admin assigns one) — this is what the order form's
 * outlet dropdown draws from. Admin and stock see every outlet, assigned or not.
 */
export async function GET(req: Request) {
  try {
    const user = await authorize(req, ALL_ROLES);
    const outlets = await prisma.outlet.findMany({
      where: user.role === "agent" ? { agentId: user.id } : undefined,
      orderBy: { name: "asc" },
      select: outletSelect,
    });
    const body: OutletDTO[] = outlets.map(toOutletDTO);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const input = await parseBody(req, createOutletSchema);
    const outlet = await prisma.outlet.create({
      data: { name: input.name, phone: input.phone, agentId: input.agentId },
      select: outletSelect,
    });
    return NextResponse.json(toOutletDTO(outlet), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
