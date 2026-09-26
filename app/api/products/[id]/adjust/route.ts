import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { adjustStockSchema } from "@/lib/validation";
import { toProductDTO } from "@/lib/products";

/** Manual stock correction (up or down) with a required reason. Never allows negative stock. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin"]);
    const { id } = await params;
    const { change, reason } = await parseBody(req, adjustStockSchema);

    const product = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ name: string; stockQty: number }[]>`
        SELECT "name", "stockQty" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
      const current = rows[0];
      if (!current) throw new HttpError(404, "Product not found");
      if (current.stockQty + change < 0) {
        throw new HttpError(
          400,
          `Cannot remove ${-change} of ${current.name}: only ${current.stockQty} in stock. Stock can't go below zero.`,
        );
      }
      const updated = await tx.product.update({ where: { id }, data: { stockQty: { increment: change } } });
      await tx.stockMovement.create({ data: { productId: id, change, type: "ADJUST", reason, staffId: user.id } });
      return updated;
    });
    return NextResponse.json(toProductDTO(product, user.role));
  } catch (err) {
    return errorResponse(err);
  }
}
