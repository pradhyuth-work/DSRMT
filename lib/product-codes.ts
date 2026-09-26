import type { Prisma } from "@prisma/client";

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
