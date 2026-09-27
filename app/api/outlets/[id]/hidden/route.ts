import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { hideOutletSchema } from "@/lib/validation";
import { outletSelect, toOutletDTO } from "@/lib/outlets";
import type { OutletDTO } from "@/lib/types";

/**
 * Hide (or unhide) an outlet from the order-taking pickers. Nothing is deleted — the
 * outlet, its orders and its ledger balance are untouched, and it still shows up in Outlet
 * Ledgers and every report. Hiding is refused while it has an order still in flight
 * (PENDING or BILLED), so a hidden outlet never strands an order out of reach.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin"]);
    const { id } = await params;
    const { hidden } = await parseBody(req, hideOutletSchema);

    const exists = await prisma.outlet.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "Outlet not found");

    if (hidden) {
      const inFlight = await prisma.invoice.count({ where: { outletId: id, fulfilmentStatus: { in: ["PENDING", "BILLED"] } } });
      if (inFlight > 0) throw new HttpError(409, "This outlet has an order in progress — dispatch or cancel it before hiding the outlet");
    }

    const outlet = await prisma.outlet.update({ where: { id }, data: { hidden }, select: outletSelect });
    const body: OutletDTO = toOutletDTO(outlet);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
