import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import type { StockMovementDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIMIT = 200;

/** Most recent stock movements, optionally for one product (?productId=). */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin", "stock"]);
    const productId = new URL(req.url).searchParams.get("productId") || undefined;
    const rows = await prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      include: { product: { select: { name: true } }, staff: { select: { name: true } } },
    });
    const body: StockMovementDTO[] = rows.map((m) => ({
      id: m.id,
      productId: m.productId,
      productName: m.product.name,
      change: m.change,
      type: m.type,
      reason: m.reason,
      invoiceId: m.invoiceId,
      staffName: m.staff.name,
      createdAt: m.createdAt.toISOString(),
    }));
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
