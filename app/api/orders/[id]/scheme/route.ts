import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { lockInvoice, orderInclude, toOrderDTO } from "@/lib/orders";
import { round2, statusFor } from "@/lib/money";
import { effectiveSchemePrice } from "@/lib/products";
import { toggleSchemeSchema } from "@/lib/validation";
import type { OrderDTO } from "@/lib/types";

/**
 * Switches a single line item between normal and scheme pricing. Admin and agents can toggle
 * it (agents only on their own orders, same scoping as cancel) — stock incharge doesn't get
 * this control. Only while the order is still PENDING — once billed, the bill number is tied
 * to whatever total was on it at the time, so the price can't move out from under it.
 * Reprices off the product's current unitPrice/schemePrice; a missing schemePrice on the
 * product blocks turning scheme on for its line. Other lines on the same order are untouched.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(req, ["admin", "agent"]);
    const { id } = await params;
    const { productId, hasScheme } = await parseBody(req, toggleSchemeSchema);

    const order = await prisma.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, id);
      if (user.role === "agent" && invoice.staffId !== user.id) {
        throw new HttpError(403, "You can only change orders you created");
      }
      if (invoice.fulfilmentStatus !== "PENDING") {
        throw new HttpError(409, "Scheme pricing can only be changed before the order is billed");
      }

      const item = invoice.items.find((i) => i.productId === productId);
      if (!item) throw new HttpError(404, "That product isn't on this order");
      if (item.hasScheme === hasScheme) {
        return tx.invoice.findUniqueOrThrow({ where: { id }, include: orderInclude });
      }

      const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      if (hasScheme && effectiveSchemePrice(product) == null) {
        throw new HttpError(400, `No scheme price set for: ${product.name} — set one from Stock first`);
      }

      const unitPrice = hasScheme ? effectiveSchemePrice(product)! : product.unitPrice;
      const subtotal = round2(unitPrice * item.quantity);
      await tx.invoiceItem.update({ where: { id: item.id }, data: { unitPrice, subtotal, hasScheme } });

      const totalAmount = round2(
        invoice.items.reduce((sum, i) => sum + (i.id === item.id ? subtotal : i.subtotal), 0),
      );
      const balanceDue = round2(totalAmount - invoice.paidAmount);
      return tx.invoice.update({
        where: { id },
        data: { totalAmount, balanceDue, status: statusFor(totalAmount, invoice.paidAmount) },
        include: orderInclude,
      });
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    const body: OrderDTO = toOrderDTO(order);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
