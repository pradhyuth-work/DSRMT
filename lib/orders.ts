import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import { round2 } from "./money";
import type { OrderDTO, Role, SaleItemInput } from "./types";

const INVOICE_PREFIX = "INV-";
const FIRST_INVOICE_NUMBER = 1001;
// Arbitrary key for pg_advisory_xact_lock so concurrent sales never compute the same id.
const INVOICE_ID_LOCK = 1001;

export async function nextInvoiceId(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVOICE_ID_LOCK})`;
  const last = await tx.invoice.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  const lastNumber = last ? Number.parseInt(last.id.slice(INVOICE_PREFIX.length), 10) : NaN;
  let next = Number.isFinite(lastNumber) ? lastNumber + 1 : FIRST_INVOICE_NUMBER;
  // Guard against gaps/out-of-order ids so we never collide with an existing invoice.
  while (await tx.invoice.findUnique({ where: { id: `${INVOICE_PREFIX}${next}` }, select: { id: true } })) {
    next++;
  }
  return `${INVOICE_PREFIX}${next}`;
}

export interface PricedLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

/**
 * Merges duplicate products, prices each line at the current unit price and checks the
 * requested quantity against current stock. Stock is not reserved here; it is deducted
 * at dispatch. Field agents get an error without exact stock counts.
 */
export async function priceLines(
  tx: Prisma.TransactionClient,
  items: SaleItemInput[],
  role: Role,
): Promise<{ lines: PricedLine[]; totalAmount: number }> {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }

  const products = await tx.product.findMany({ where: { id: { in: [...quantities.keys()] } } });
  const productById = new Map(products.map((p) => [p.id, p]));

  const shortages: { productId: string; name: string; requested: number; available: number }[] = [];
  for (const [productId, quantity] of quantities) {
    const product = productById.get(productId);
    if (!product) throw new HttpError(400, `Product ${productId} not found`);
    if (product.stockQty < quantity) {
      shortages.push({ productId, name: product.name, requested: quantity, available: product.stockQty });
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

  const lines = [...quantities].map(([productId, quantity]) => {
    const product = productById.get(productId)!;
    return {
      productId,
      productName: product.name,
      quantity,
      unitPrice: product.unitPrice,
      subtotal: round2(product.unitPrice * quantity),
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
  dispatchedBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
  items: { include: { product: { select: { name: true } } } },
} satisfies Prisma.InvoiceInclude;

type OrderWithRelations = Prisma.InvoiceGetPayload<{ include: typeof orderInclude }>;

export function toOrderDTO(o: OrderWithRelations): OrderDTO {
  return {
    id: o.id,
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
    })),
  };
}
