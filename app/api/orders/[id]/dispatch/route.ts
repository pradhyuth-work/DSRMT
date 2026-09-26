import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { lockInvoice, orderInclude, toOrderDTO } from "@/lib/orders";
import type { OrderDTO } from "@/lib/types";

/**
 * Dispatches a pending order in one transaction: lock the order, confirm it is PENDING,
 * lock its products, refuse if any is short, deduct stock, record DISPATCH movements and
 * mark the order DISPATCHED. Nothing is changed if any step fails.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { id } = await params;

    const order = await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      if (invoice.fulfilmentStatus !== "PENDING") {
        throw new HttpError(409, `Order ${id} is already ${invoice.fulfilmentStatus.toLowerCase()}`);
      }

      const needed = new Map<string, number>();
      for (const item of invoice.items) {
        needed.set(item.productId, (needed.get(item.productId) ?? 0) + item.quantity);
      }
      const productIds = [...needed.keys()].sort();

      // Lock in a consistent order so two dispatches sharing products can't deadlock.
      const stock = await tx.$queryRaw<{ id: string; name: string; stockQty: number }[]>`
        SELECT "id", "name", "stockQty" FROM "Product"
        WHERE "id" IN (${Prisma.join(productIds)})
        ORDER BY "id"
        FOR UPDATE`;

      const shortages = stock
        .filter((p) => p.stockQty < needed.get(p.id)!)
        .map((p) => `${p.name} (need ${needed.get(p.id)}, have ${p.stockQty})`);
      if (shortages.length > 0) {
        throw new HttpError(400, `Cannot dispatch ${id}: insufficient stock for ${shortages.join(", ")}`);
      }

      for (const productId of productIds) {
        const quantity = needed.get(productId)!;
        await tx.product.update({ where: { id: productId }, data: { stockQty: { decrement: quantity } } });
        await tx.stockMovement.create({
          data: { productId, change: -quantity, type: "DISPATCH", invoiceId: id, staffId: user.id },
        });
      }

      return tx.invoice.update({
        where: { id },
        data: { fulfilmentStatus: "DISPATCHED", dispatchedAt: new Date(), dispatchedById: user.id },
        include: orderInclude,
      });
    });

    const body: OrderDTO = toOrderDTO(order);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
