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
 * just combined: every order must be BILLED. Stock was already deducted at billing, so this only
 * flips the status. All-or-nothing — if any order isn't billed, nothing is dispatched.
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin", "stock"]);
    const { orderIds: rawIds } = await parseBody(req, dispatchBulkSchema);
    const orderIds = [...new Set(rawIds)].sort();

    const orders = await prisma.$transaction(async (tx) => {
      // Lock in a consistent order so a bulk dispatch sharing orders with another
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
