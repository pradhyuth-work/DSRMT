import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { changeProductCodeSchema } from "@/lib/validation";
import { changeProductCode } from "@/lib/product-codes";
import { toProductDTO } from "@/lib/products";

/**
 * Explicitly renumbers a product's #code, shifting only the products between its old and
 * new position (see lib/product-codes.ts) — everything else keeps its number. Admin only.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin"]);
    const { id } = await params;
    const { newCode } = await parseBody(req, changeProductCodeSchema);

    const product = await prisma.$transaction(async (tx) => {
      await changeProductCode(tx, id, newCode);
      return tx.product.findUniqueOrThrow({ where: { id } });
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    return NextResponse.json(toProductDTO(product, user.role));
  } catch (err) {
    return errorResponse(err);
  }
}
