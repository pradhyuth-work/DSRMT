import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { ALL_ROLES, authorize } from "@/lib/auth";
import { createProductSchema } from "@/lib/validation";
import { round2 } from "@/lib/money";
import { toProductDTO } from "@/lib/products";
import { reserveProductCode } from "@/lib/product-codes";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await authorize(req, ALL_ROLES);
    const products = await prisma.product.findMany({ orderBy: { productCode: "asc" } });
    return NextResponse.json(products.map((p) => toProductDTO(p, user.role)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Creating a product is a stock-inwarding action (it sets opening stock), so it's admin-only. */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin"]);
    const input = await parseBody(req, createProductSchema);
    const product = await prisma.$transaction(async (tx) => {
      const productCode = await reserveProductCode(tx, input.productCode);
      const created = await tx.product.create({
        data: { productCode, name: input.name, unitPrice: round2(input.unitPrice), stockQty: input.stockQty },
      });
      if (input.stockQty > 0) {
        await tx.stockMovement.create({
          data: { productId: created.id, change: input.stockQty, type: "RECEIVE", reason: "Opening stock", staffId: user.id },
        });
      }
      return created;
    }, { timeout: TRANSACTION_TIMEOUT_MS });
    return NextResponse.json(toProductDTO(product, user.role), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
