import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { bulkRateSchema } from "@/lib/validation";
import { round2 } from "@/lib/money";
import type { BulkRateResponse, BulkRateResultRow } from "@/lib/types";

/**
 * Bulk price update (CSV or the in-app grid) — every row's productCode must already exist;
 * this never creates a product. Every row is validated first, and the whole batch is
 * rejected with every problem at once if any productCode isn't found, rather than
 * re-pricing some products and not others. Admin only.
 */
export async function POST(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const { rows } = await parseBody(req, bulkRateSchema);

    const products = await prisma.product.findMany({
      where: { productCode: { in: rows.map((r) => r.productCode) } },
      select: { id: true, productCode: true },
    });
    const byCode = new Map(products.map((p) => [p.productCode, p.id]));

    const errors: { row: number; error: string }[] = [];
    const plan = rows.map((r, i) => {
      const rowNum = i + 1;
      const productId = byCode.get(r.productCode);
      if (!productId) errors.push({ row: rowNum, error: `No product #${r.productCode}` });
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
    });

    const body: BulkRateResponse = { results };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
