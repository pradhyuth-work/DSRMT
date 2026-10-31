import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import { round2 } from "./money";
import { effectiveSchemePrice } from "./products";
import type { OrderDTO, Role, SaleItemInput } from "./types";

export interface PricedLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  hasScheme: boolean;
}

/**
 * Merges duplicate products, prices each line at the current unit price (or schemePrice,
 * per line, when that line's own `hasScheme` is set — used when editing an order that
 * already has some lines on scheme pricing, so adding/removing other items doesn't silently
 * revert them to normal pricing) and checks the requested quantity against stock still free
 * to claim. Stock itself isn't deducted here (that happens at billing), but quantities
 * already sitting on *other* PENDING orders are subtracted from stockQty first — otherwise
 * two orders for the same scarce product can both pass this check and the slower one fails
 * at billing instead, after the agent and outlet already think the order went through.
 * `excludeInvoiceId` leaves an order's own existing items out of that reservation total when
 * it's being edited, so re-saving it with the same or smaller quantities doesn't count its
 * old items against itself. Field agents get an error without exact stock counts.
 */
export async function priceLines(
  tx: Prisma.TransactionClient,
  items: SaleItemInput[],
  role: Role,
  excludeInvoiceId?: string,
): Promise<{ lines: PricedLine[]; totalAmount: number }> {
  const quantities = new Map<string, number>();
  const schemeByProduct = new Map<string, boolean>();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    schemeByProduct.set(item.productId, item.hasScheme ?? false);
  }
  const productIds = [...quantities.keys()];

  const [products, reserved] = await Promise.all([
    tx.product.findMany({ where: { id: { in: productIds } } }),
    tx.invoiceItem.groupBy({
      by: ["productId"],
      where: {
        productId: { in: productIds },
        invoice: {
          fulfilmentStatus: "PENDING",
          ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
        },
      },
      _sum: { quantity: true },
    }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const reservedById = new Map(reserved.map((r) => [r.productId, r._sum.quantity ?? 0]));

  const shortages: { productId: string; name: string; requested: number; available: number }[] = [];
  for (const [productId, quantity] of quantities) {
    const product = productById.get(productId);
    if (!product) throw new HttpError(400, `Product ${productId} not found`);
    const available = product.stockQty - (reservedById.get(productId) ?? 0);
    if (available < quantity) {
      shortages.push({ productId, name: product.name, requested: quantity, available: Math.max(available, 0) });
    }
  }
  if (shortages.length > 0) {
    if (role === "agent") {
      const names = shortages.map((s) => s.name).join(", ");
      throw new HttpError(400, `Not enough stock for: ${names}`, {
        shortages: shortages.map(({ productId, name }) => ({ productId, name })),
      });
    }
    const summary = shortages.map((s) => `${s.name} (requested ${s.requested}, available ${s.available})`).join(", ");
    throw new HttpError(400, `Insufficient stock: ${summary}`, { shortages });
  }

  const missing = [...quantities.keys()]
    .filter((productId) => schemeByProduct.get(productId))
    .map((productId) => productById.get(productId)!)
    .filter((p) => effectiveSchemePrice(p) == null)
    .map((p) => p.name);
  if (missing.length > 0) {
    throw new HttpError(400, `No scheme price set for: ${missing.join(", ")} — set one from Stock first`);
  }

  const lines = [...quantities].map(([productId, quantity]) => {
    const product = productById.get(productId)!;
    const hasScheme = schemeByProduct.get(productId) ?? false;
    const unitPrice = hasScheme ? effectiveSchemePrice(product)! : product.unitPrice;
    return {
      productId,
      productName: product.name,
      quantity,
      unitPrice,
      subtotal: round2(unitPrice * quantity),
      hasScheme,
    };
  });
  return { lines, totalAmount: round2(lines.reduce((sum, l) => sum + l.subtotal, 0)) };
}

/** Locks an invoice row for the rest of the transaction and returns its current state. */
export async function lockInvoice(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Invoice" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new HttpError(404, "Order not found");
  return tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: true } });
}

export const orderInclude = {
  outlet: { select: { name: true } },
  staff: { select: { name: true } },
  billedBy: { select: { name: true } },
  dispatchedBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
  items: { include: { product: { select: { name: true } } } },
} satisfies Prisma.InvoiceInclude;

type OrderWithRelations = Prisma.InvoiceGetPayload<{ include: typeof orderInclude }>;

export function toOrderDTO(o: OrderWithRelations): OrderDTO {
  return {
    id: o.id,
    invoiceNumber: o.invoiceNumber,
    outletId: o.outletId,
    outletName: o.outlet.name,
    staffId: o.staffId,
    staffName: o.staff.name,
    totalAmount: o.totalAmount,
    paidAmount: o.paidAmount,
    balanceDue: o.balanceDue,
    status: o.status,
    fulfilmentStatus: o.fulfilmentStatus,
    createdAt: o.createdAt.toISOString(),
    billedAt: o.billedAt?.toISOString() ?? null,
    billedByName: o.billedBy?.name ?? null,
    dispatchedAt: o.dispatchedAt?.toISOString() ?? null,
    dispatchedByName: o.dispatchedBy?.name ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    cancelledByName: o.cancelledBy?.name ?? null,
    items: o.items.map((i) => ({
      productId: i.productId,
      productName: i.product.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      subtotal: i.subtotal,
      hasScheme: i.hasScheme,
    })),
  };
}
