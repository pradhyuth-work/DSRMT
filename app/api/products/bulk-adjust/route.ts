import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { bulkAdjustSchema } from "@/lib/validation";
import type { BulkAdjustResponse, BulkAdjustResultRow } from "@/lib/types";

/**
 * Bulk stock correction (up or down), each row with its own required reason — the same
 * one-row-per-product-code shape as bulk-rate, but writing a StockMovement instead of just
 * a price. Every product must already exist (this never creates one). Every row is
 * validated first — including "would this take stock below zero", tallied cumulatively so
 * two rows touching the same product in one upload are checked against each other, not just
 * today's stock — and the whole batch is rejected together if any row fails. Admin only.
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin"]);
    const { rows } = await parseBody(req, bulkAdjustSchema);

    const products = await prisma.product.findMany({ where: { productCode: { in: rows.map((r) => r.productCode) } } });
    const byCode = new Map(products.map((p) => [p.productCode, p]));
    const runningStock = new Map(products.map((p) => [p.id, p.stockQty]));

    const errors: { row: number; error: string }[] = [];
    const plan: { row: number; productId: string; productCode: number; productName: string; change: number; reason: string }[] = [];
    rows.forEach((r, i) => {
      const rowNum = i + 1;
      const product = byCode.get(r.productCode);
      if (!product) {
        errors.push({ row: rowNum, error: `No product #${r.productCode}` });
        return;
      }
      const before = runningStock.get(product.id)!;
      const after = before + r.change;
      if (after < 0) {
        errors.push({
          row: rowNum,
          error: `Cannot remove ${-r.change} of ${product.name}: only ${before} would be in stock. Stock can't go below zero.`,
        });
        return;
      }
      runningStock.set(product.id, after);
      plan.push({ row: rowNum, productId: product.id, productCode: product.productCode, productName: product.name, change: r.change, reason: r.reason });
    });

    if (errors.length > 0) {
      throw new HttpError(400, `${errors.length} row${errors.length === 1 ? "" : "s"} could not be processed`, { errors });
    }

    const results = await prisma.$transaction(
      async (tx) => {
        const out: BulkAdjustResultRow[] = [];
        for (const p of plan) {
          const updated = await tx.product.update({ where: { id: p.productId }, data: { stockQty: { increment: p.change } } });
          await tx.stockMovement.create({ data: { productId: p.productId, change: p.change, type: "ADJUST", reason: p.reason, staffId: user.id } });
          out.push({ row: p.row, productId: updated.id, productCode: updated.productCode, productName: updated.name, change: p.change, newStockQty: updated.stockQty });
        }
        return out;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    const body: BulkAdjustResponse = { results };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
