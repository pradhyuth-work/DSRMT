import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { restockSchema } from "@/lib/validation";
import { toProductDTO } from "@/lib/products";

/** Receive stock: adds units and records a RECEIVE movement. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin"]);
    const { id } = await params;
    const { quantity, reason, supplierRef } = await parseBody(req, restockSchema);

    const product = await prisma.$transaction(async (tx) => {
      const exists = await tx.product.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new HttpError(404, "Product not found");
      const updated = await tx.product.update({ where: { id }, data: { stockQty: { increment: quantity } } });
      await tx.stockMovement.create({
        data: { productId: id, change: quantity, type: "RECEIVE", reason: reason || null, supplierRef: supplierRef || null, staffId: user.id },
      });
      return updated;
    }, { timeout: TRANSACTION_TIMEOUT_MS });
    return NextResponse.json(toProductDTO(product, user.role));
  } catch (err) {
    return errorResponse(err);
  }
}
