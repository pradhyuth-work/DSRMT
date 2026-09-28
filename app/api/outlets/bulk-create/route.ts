import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { bulkOutletSchema } from "@/lib/validation";
import { outletSelect, toOutletDTO } from "@/lib/outlets";
import type { BulkOutletResponse, BulkOutletResultRow } from "@/lib/types";

/**
 * Bulk outlet creation — the same CSV-or-paste-grid flow as bulk stock receive, and the
 * one single-outlet creation goes through too (the "Add outlet" form just posts a
 * one-row batch here). Admin only.
 *
 * A row's routeName is matched case-insensitively against an existing route; nothing is
 * created if any row references a route that doesn't exist — every row is validated
 * first, and the whole batch is rejected with every problem at once so it can be fixed
 * and resubmitted, rather than creating some outlets and not others.
 */
export async function POST(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { rows } = await parseBody(req, bulkOutletSchema);

    const routes = await prisma.route.findMany({ select: { id: true, name: true } });
    const routeByName = new Map(routes.map((r) => [r.name.trim().toLowerCase(), r.id]));

    const errors: { row: number; error: string }[] = [];
    const plan = rows.map((r, i) => {
      const rowNum = i + 1;
      let routeId: string | null = null;
      if (r.routeName) {
        const match = routeByName.get(r.routeName.trim().toLowerCase());
        if (!match) {
          errors.push({ row: rowNum, error: `No route named "${r.routeName}" — check spelling or create it first from Manage routes` });
        } else {
          routeId = match;
        }
      }
      return { row: rowNum, name: r.name, phone: r.phone ?? "", address: r.address ?? "", gstNumber: r.gstNumber || null, routeId };
    });

    if (errors.length > 0) {
      throw new HttpError(400, `${errors.length} row${errors.length === 1 ? "" : "s"} could not be processed`, { errors });
    }

    const results = await prisma.$transaction(async (tx) => {
      const out: BulkOutletResultRow[] = [];
      for (const p of plan) {
        const created = await tx.outlet.create({
          data: { name: p.name, phone: p.phone, address: p.address, gstNumber: p.gstNumber, routeId: p.routeId },
          select: outletSelect,
        });
        out.push({ row: p.row, outletId: created.id, outletName: created.name, routeName: created.route?.name ?? null });
      }
      return out;
    }, { timeout: 60_000, maxWait: 10_000 });

    const body: BulkOutletResponse = { results };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
