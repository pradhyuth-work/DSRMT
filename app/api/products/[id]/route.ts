import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { updateProductSchema } from "@/lib/validation";
import { round2 } from "@/lib/money";
import { toProductDTO } from "@/lib/products";

/** Edit a product's name or price. Stock changes go through /restock or /adjust. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { id } = await params;
    const input = await parseBody(req, updateProductSchema);

    const exists = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "Product not found");

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: input.name,
        unitPrice: input.unitPrice === undefined ? undefined : round2(input.unitPrice),
      },
    });
    return NextResponse.json(toProductDTO(product, user.role));
  } catch (err) {
    return errorResponse(err);
  }
}
