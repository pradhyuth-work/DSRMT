import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse } from "@/lib/api";
import { ALL_ROLES, authorize } from "@/lib/auth";
import { orderInclude, toOrderDTO } from "@/lib/orders";
import type { FulfilmentStatus, OrderDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: FulfilmentStatus[] = ["PENDING", "DISPATCHED", "CANCELLED"];
const LIMIT = 200;

/**
 * Lists orders, newest first (?status=PENDING|DISPATCHED|CANCELLED to filter).
 * Admin and stock see every order; agents only ever see orders they own.
 */
export async function GET(req: Request) {
  try {
    const user = await authorize(req, ALL_ROLES);
    const status = new URL(req.url).searchParams.get("status");
    if (status && !STATUSES.includes(status as FulfilmentStatus)) {
      throw new HttpError(400, `status must be one of ${STATUSES.join(", ")}`);
    }

    const where: Prisma.InvoiceWhereInput = {
      fulfilmentStatus: (status as FulfilmentStatus | null) ?? undefined,
      staffId: user.role === "agent" ? user.id : undefined,
    };
    const orders = await prisma.invoice.findMany({
      where,
      // Oldest first when working the pending queue; newest first otherwise.
      orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
      take: LIMIT,
      include: orderInclude,
    });
    const body: OrderDTO[] = orders.map(toOrderDTO);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
