import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { restockSchema } from "@/lib/validation";
import type { ProductDTO } from "@/lib/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { quantity } = await parseBody(req, restockSchema);

    const exists = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "Product not found");

    const p = await prisma.product.update({
      where: { id },
      data: { stockQty: { increment: quantity } },
    });
    const body: ProductDTO = {
      id: p.id,
      name: p.name,
      unitPrice: p.unitPrice,
      stockQty: p.stockQty,
      createdAt: p.createdAt.toISOString(),
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
