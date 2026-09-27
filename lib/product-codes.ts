import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";

// Arbitrary advisory-lock key, distinct from the invoice-id lock (1001) and each other.
const PRODUCT_CODE_LOCK = 2002;

/**
 * Reserves a productCode for a new product, inside the caller's transaction.
 *
 * With no desired code, returns the next free one (max + 1). With a desired code that's
 * already taken, that product and every later one are shifted up by one — highest code
 * first — so nothing ever collides mid-shift, then the desired code is handed back free.
 * A desired code higher than the current max is simply returned as-is (nothing to shift).
 *
 * Takes an advisory lock for the rest of the transaction so two concurrent inserts can't
 * both reserve the same code.
 */
export async function reserveProductCode(tx: Prisma.TransactionClient, desiredCode?: number): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PRODUCT_CODE_LOCK})`;

  if (desiredCode === undefined) {
    const top = await tx.product.findFirst({ orderBy: { productCode: "desc" }, select: { productCode: true } });
    return (top?.productCode ?? 0) + 1;
  }

  const toShift = await tx.product.findMany({
    where: { productCode: { gte: desiredCode } },
    orderBy: { productCode: "desc" },
    select: { id: true, productCode: true },
  });
  // Highest first: each target slot (code + 1) was just vacated by the previous iteration,
  // so no update ever collides with the unique index.
  for (const p of toShift) {
    await tx.product.update({ where: { id: p.id }, data: { productCode: p.productCode + 1 } });
  }
  return desiredCode;
}

/**
 * Renumbers an existing product to `newCode`, inside the caller's transaction. Unlike
 * `reserveProductCode` (which always shifts everything at/after the desired code up, since
 * it's making room for a brand-new row), this only has to resolve a collision — the moving
 * product vacates its own old slot, so only the sub-range between its old and new code ever
 * needs to shift, and by one step each, in the direction that closes the gap it leaves:
 *
 *   - Moving to a lower code: everything in [newCode, oldCode) shifts up by one, highest
 *     first, freeing newCode; the shifted row that lands on oldCode fills the gap.
 *   - Moving to a higher code: everything in (oldCode, newCode] shifts down by one, lowest
 *     first, freeing newCode; the shifted row that lands on oldCode fills the gap.
 *
 * Nothing outside that sub-range moves — a product two positions away from either end never
 * needs to know this happened.
 */
export async function changeProductCode(tx: Prisma.TransactionClient, productId: string, newCode: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PRODUCT_CODE_LOCK})`;

  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, productCode: true } });
  if (!product) throw new HttpError(404, "Product not found");
  const oldCode = product.productCode;
  if (oldCode === newCode) return;

  // The moving row still holds oldCode until the final update below, so the first shifted
  // neighbour to land on oldCode would collide with it under the unique index. Vacate oldCode
  // into a sentinel that's never a real code (codes are always positive) before shifting.
  await tx.product.update({ where: { id: productId }, data: { productCode: -1 } });

  if (newCode < oldCode) {
    const toShift = await tx.product.findMany({
      where: { productCode: { gte: newCode, lt: oldCode }, id: { not: productId } },
      orderBy: { productCode: "desc" },
      select: { id: true, productCode: true },
    });
    for (const p of toShift) {
      await tx.product.update({ where: { id: p.id }, data: { productCode: p.productCode + 1 } });
    }
  } else {
    const toShift = await tx.product.findMany({
      where: { productCode: { gt: oldCode, lte: newCode }, id: { not: productId } },
      orderBy: { productCode: "asc" },
      select: { id: true, productCode: true },
    });
    for (const p of toShift) {
      await tx.product.update({ where: { id: p.id }, data: { productCode: p.productCode - 1 } });
    }
  }

  await tx.product.update({ where: { id: productId }, data: { productCode: newCode } });
}
