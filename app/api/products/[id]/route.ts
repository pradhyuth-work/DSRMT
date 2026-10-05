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
    const user = await authorize(req, ["admin"]);
    const { id } = await params;
    const input = await parseBody(req, updateProductSchema);

    const exists = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "Product not found");

    // Setting a scheme price (or clearing it) implies the matching active state, unless the
    // caller passes schemeActive explicitly — e.g. the Stock toggle reactivating an existing
    // stored price with no schemePrice in the request at all.
    const schemeActive =
      input.schemeActive !== undefined ? input.schemeActive : input.schemePrice !== undefined ? input.schemePrice != null : undefined;

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: input.name,
        unitPrice: input.unitPrice === undefined ? undefined : round2(input.unitPrice),
        schemePrice: input.schemePrice === undefined ? undefined : input.schemePrice === null ? null : round2(input.schemePrice),
        schemeActive,
      },
    });
    return NextResponse.json(toProductDTO(product, user.role));
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Delete a product. Refused once it's ever been on an order (a DISPATCH movement always
 * implies one, so checking InvoiceItem alone is enough) — the sales history it would take
 * down with it is never worth it. A product that only ever had warehouse-side movements
 * (its opening stock, a restock, a manual adjustment) can still be removed; those harmless
 * housekeeping rows are cleared along with it. Admin only.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, ["admin"]);
    const { id } = await params;

    const exists = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new HttpError(404, "Product not found");

    const everOrdered = await prisma.invoiceItem.count({ where: { productId: id } });
    if (everOrdered > 0) throw new HttpError(409, "This product has order history and can't be deleted");

    await prisma.$transaction([
      prisma.stockMovement.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
