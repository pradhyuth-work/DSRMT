import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { lockInvoice, orderInclude, toOrderDTO } from "@/lib/orders";
import { round2, statusFor } from "@/lib/money";
import { toggleSchemeSchema } from "@/lib/validation";
import type { OrderDTO } from "@/lib/types";

/**
 * Switches an order between normal and scheme pricing. Admin and agents can toggle it
 * (agents only on their own orders, same scoping as cancel) — stock incharge doesn't get
 * this control. Only while the order is still PENDING — once billed, the bill number is
 * tied to whatever total was on it at the time, so the price can't move out from under it.
 * Every line reprices off the product's current unitPrice/schemePrice; a missing
 * schemePrice on any item blocks turning scheme on.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin", "agent"]);
    const { id } = await params;
    const { hasScheme } = await parseBody(req, toggleSchemeSchema);

    const order = await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      if (user.role === "agent" && invoice.staffId !== user.id) {
        throw new HttpError(403, "You can only change orders you created");
      }
      if (invoice.fulfilmentStatus !== "PENDING") {
        throw new HttpError(409, "Scheme pricing can only be changed before the order is billed");
      }
      if (invoice.hasScheme === hasScheme) {
        return tx.invoice.findUniqueOrThrow({ where: { id }, include: orderInclude });
      }

      const products = await tx.product.findMany({ where: { id: { in: invoice.items.map((i) => i.productId) } } });
      const productById = new Map(products.map((p) => [p.id, p]));

      if (hasScheme) {
        const missing = invoice.items
          .filter((i) => productById.get(i.productId)?.schemePrice == null)
          .map((i) => productById.get(i.productId)?.name ?? i.productId);
        if (missing.length > 0) {
          throw new HttpError(400, `No scheme price set for: ${missing.join(", ")} — set one from Stock first`);
        }
      }

      let totalAmount = 0;
      for (const item of invoice.items) {
        const product = productById.get(item.productId)!;
        const unitPrice = hasScheme ? product.schemePrice! : product.unitPrice;
        const subtotal = round2(unitPrice * item.quantity);
        totalAmount = round2(totalAmount + subtotal);
        await tx.invoiceItem.update({ where: { id: item.id }, data: { unitPrice, subtotal } });
      }

      const balanceDue = round2(totalAmount - invoice.paidAmount);
      return tx.invoice.update({
        where: { id },
        data: { hasScheme, totalAmount, balanceDue, status: statusFor(totalAmount, invoice.paidAmount) },
        include: orderInclude,
      });
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    const body: OrderDTO = toOrderDTO(order);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
