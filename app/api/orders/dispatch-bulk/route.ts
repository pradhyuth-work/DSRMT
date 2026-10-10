import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { orderInclude, toOrderDTO } from "@/lib/orders";
import { dispatchBulkSchema } from "@/lib/validation";
import type { DispatchBulkResponse } from "@/lib/types";

/**
 * Dispatches several billed orders in one shot — for handing a field agent all their stock
 * at once instead of one dispatch click per order. Same rules as POST /api/orders/:id/dispatch,
 * just combined: every order must be BILLED, and stock is checked against the *combined*
 * quantity needed across all of them (an item split across two of the agent's orders only
 * needs to be available once, summed). All-or-nothing — if any order isn't billed or any
 * product falls short, nothing is dispatched.
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { orderIds: rawIds } = await parseBody(req, dispatchBulkSchema);
    const orderIds = [...new Set(rawIds)].sort();

    const orders = await prisma.$transaction(async (tx) => {
      // Lock in a consistent order so a bulk dispatch sharing orders/products with another
      // dispatch (bulk or single) can't deadlock.
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" IN (${Prisma.join(orderIds)}) ORDER BY "id" FOR UPDATE`;

      const invoices = await tx.invoice.findMany({ where: { id: { in: orderIds } }, include: { items: true } });
      if (invoices.length !== orderIds.length) {
        const found = new Set(invoices.map((i) => i.id));
        const missing = orderIds.filter((id) => !found.has(id));
        throw new HttpError(404, `Order(s) not found: ${missing.join(", ")}`);
      }

      const notBilled = invoices.filter((i) => i.fulfilmentStatus !== "BILLED");
      if (notBilled.length > 0) {
        const summary = notBilled.map((i) => `${i.invoiceNumber ?? i.id} (${i.fulfilmentStatus.toLowerCase()})`).join(", ");
        throw new HttpError(409, `All selected orders must be billed first: ${summary}`);
      }

      const needed = new Map<string, number>();
      for (const invoice of invoices) {
        for (const item of invoice.items) {
          needed.set(item.productId, (needed.get(item.productId) ?? 0) + item.quantity);
        }
      }
      const productIds = [...needed.keys()].sort();

      const stock = await tx.$queryRaw<{ id: string; name: string; stockQty: number }[]>`
        SELECT "id", "name", "stockQty" FROM "Product"
        WHERE "id" IN (${Prisma.join(productIds)})
        ORDER BY "id"
        FOR UPDATE`;

      const shortages = stock
        .filter((p) => p.stockQty < needed.get(p.id)!)
        .map((p) => `${p.name} (need ${needed.get(p.id)}, have ${p.stockQty})`);
      if (shortages.length > 0) {
        throw new HttpError(400, `Cannot dispatch this batch: insufficient stock for ${shortages.join(", ")}`);
      }

      // Every query inside the transaction is a network round trip over the pooler, so keep the
      // count small: one decrement per product (already summed), then single batched writes for
      // the stock movements and invoice status instead of one query per item / per order.
      for (const productId of productIds) {
        await tx.product.update({ where: { id: productId }, data: { stockQty: { decrement: needed.get(productId)! } } });
      }
      await tx.stockMovement.createMany({
        data: invoices.flatMap((invoice) =>
          invoice.items.map((item) => ({
            productId: item.productId,
            change: -item.quantity,
            type: "DISPATCH" as const,
            invoiceId: invoice.id,
            staffId: user.id,
          })),
        ),
      });
      await tx.invoice.updateMany({
        where: { id: { in: orderIds } },
        data: { fulfilmentStatus: "DISPATCHED", dispatchedAt: new Date(), dispatchedById: user.id },
      });

      return tx.invoice.findMany({ where: { id: { in: orderIds } }, include: orderInclude });
      // Bulk dispatch can touch many orders/products, so use the same generous limits as the
      // other bulk routes (the default 2s maxWait for a pooled connection is also too tight).
    }, { timeout: 60_000, maxWait: 10_000 });

    const body: DispatchBulkResponse = { orders: orders.map(toOrderDTO) };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
