import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { bulkRateSchema } from "@/lib/validation";
import { round2 } from "@/lib/money";
import type { BulkRateResponse, BulkRateResultRow } from "@/lib/types";

/**
 * Bulk price update (CSV or the in-app grid) — every row's product name must already exist;
 * this never creates a product. Every row is validated first, and the whole batch is
 * rejected with every problem at once if any product name isn't found, rather than
 * re-pricing some products and not others. Admin only.
 */
export async function POST(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { rows } = await parseBody(req, bulkRateSchema);

    const products = await prisma.product.findMany({ select: { id: true, name: true } });
    const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p.id]));

    const errors: { row: number; error: string }[] = [];
    const plan = rows.map((r, i) => {
      const rowNum = i + 1;
      const productId = byName.get(r.name.trim().toLowerCase());
      if (!productId) errors.push({ row: rowNum, error: `No product named "${r.name}"` });
      return { row: rowNum, productId, unitPrice: round2(r.unitPrice) };
    });

    if (errors.length > 0) {
      throw new HttpError(400, `${errors.length} row${errors.length === 1 ? "" : "s"} could not be processed`, { errors });
    }

    const results = await prisma.$transaction(async (tx) => {
      const out: BulkRateResultRow[] = [];
      for (const p of plan) {
        const updated = await tx.product.update({ where: { id: p.productId! }, data: { unitPrice: p.unitPrice } });
        out.push({ row: p.row, productId: updated.id, productCode: updated.productCode, productName: updated.name, unitPrice: updated.unitPrice });
      }
      return out;
    }, { timeout: 60_000, maxWait: 10_000 });

    const body: BulkRateResponse = { results };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
