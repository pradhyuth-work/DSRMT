import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { stockMovementsQuerySchema } from "@/lib/validation";
import { toStockMovementDTO } from "@/lib/products";
import type { StockMovementDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIMIT = 200;

/**
 * Most recent stock movements — the inventory in/out log. Optionally for one product
 * (?productId=) and/or a date range (?from=&to=), same query-param style as reports.
 */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin", "stock"]);
    const { productId, from, to } = stockMovementsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const rows = await prisma.stockMovement.findMany({
      where: { productId, createdAt: from || to ? { gte: from, lte: to } : undefined },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      include: { product: { select: { name: true } }, staff: { select: { name: true } } },
    });
    const body: StockMovementDTO[] = rows.map(toStockMovementDTO);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
