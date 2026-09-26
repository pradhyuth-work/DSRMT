import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, parseBody } from "@/lib/api";
import { createProductSchema } from "@/lib/validation";
import { round2 } from "@/lib/money";
import type { ProductDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

function toDTO(p: { id: string; name: string; unitPrice: number; stockQty: number; createdAt: Date }): ProductDTO {
  return { id: p.id, name: p.name, unitPrice: p.unitPrice, stockQty: p.stockQty, createdAt: p.createdAt.toISOString() };
}

export async function GET() {
  try {
    const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json(products.map(toDTO));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createProductSchema);
    const product = await prisma.product.create({
      data: { name: input.name, unitPrice: round2(input.unitPrice), stockQty: input.stockQty },
    });
    return NextResponse.json(toDTO(product), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
