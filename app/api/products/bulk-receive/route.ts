import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { bulkReceiveSchema } from "@/lib/validation";
import { round2 } from "@/lib/money";
import { reserveProductCode } from "@/lib/product-codes";
import type { BulkReceiveResponse, BulkReceiveResultRow } from "@/lib/types";

/**
 * Bulk stock-inwarding upload (CSV or the in-app grid both post the same row shape here).
 * Admin only — receiving stock is now exclusively an admin action.
 *
 * Each row either tops up an existing product (matched by productCode, or by productCode +
 * name when both are given and must agree) or creates a new one. All rows are resolved and
 * validated first; if any row has a problem, nothing is written — the whole upload is
 * rejected with every row's error so it can be fixed and resubmitted, rather than applying
 * part of a batch.
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin"]);
    const { rows, supplierRef } = await parseBody(req, bulkReceiveSchema);

    const results = await prisma.$transaction(async (tx) => {
      const codes = rows.map((r) => r.productCode).filter((c): c is number => c !== undefined);
      const existingByCode = new Map(
        (await tx.product.findMany({ where: { productCode: { in: codes } } })).map((p) => [p.productCode, p]),
      );

      const errors: { row: number; error: string }[] = [];
      const plan: (
        | { row: number; action: "RESTOCK"; productId: string; quantity: number }
        | { row: number; action: "CREATE"; productCode?: number; name: string; unitPrice: number; quantity: number }
      )[] = [];

      rows.forEach((r, i) => {
        const rowNum = i + 1;
        const existing = r.productCode !== undefined ? existingByCode.get(r.productCode) : undefined;

        if (existing) {
          // Same code + a name that clearly refers to a different product: don't silently
          // restock the wrong item — the row must either omit the name or match it.
          if (r.name && r.name.trim().toLowerCase() !== existing.name.trim().toLowerCase()) {
            errors.push({
              row: rowNum,
              error: `Product #${r.productCode} is "${existing.name}", not "${r.name}". Leave the name blank to restock it, or use a different code to add a new product.`,
            });
            return;
          }
          plan.push({ row: rowNum, action: "RESTOCK", productId: existing.id, quantity: r.quantity });
          return;
        }

        if (!r.name || r.unitPrice === undefined) {
          errors.push({
            row: rowNum,
            error:
              r.productCode === undefined
                ? "Give a name and unit price to create a new product (or a productCode to restock an existing one)"
                : `Product #${r.productCode} doesn't exist yet — give a name and unit price to create it`,
          });
          return;
        }
        plan.push({ row: rowNum, action: "CREATE", productCode: r.productCode, name: r.name, unitPrice: round2(r.unitPrice), quantity: r.quantity });
      });

      // Two new rows creating the same brand-new product name would both "succeed" alone
      // but collide on the unique name constraint — catch that before writing anything.
      const newNames = new Map<string, number>();
      for (const p of plan) {
        if (p.action !== "CREATE") continue;
        const key = p.name.trim().toLowerCase();
        if (newNames.has(key)) {
          errors.push({ row: p.row, error: `"${p.name}" is already used earlier in this upload (row ${newNames.get(key)})` });
        } else {
          newNames.set(key, p.row);
        }
      }

      if (errors.length > 0) {
        throw new HttpError(400, `${errors.length} row${errors.length === 1 ? "" : "s"} could not be processed`, { errors });
      }

      const out: BulkReceiveResultRow[] = [];
      for (const p of plan) {
        if (p.action === "RESTOCK") {
          const updated = await tx.product.update({ where: { id: p.productId }, data: { stockQty: { increment: p.quantity } } });
          await tx.stockMovement.create({
            data: { productId: p.productId, change: p.quantity, type: "RECEIVE", reason: "Bulk upload", supplierRef: supplierRef || null, staffId: user.id },
          });
          out.push({ row: p.row, action: "RESTOCK", productId: updated.id, productCode: updated.productCode, productName: updated.name, newStockQty: updated.stockQty });
        } else {
          const productCode = await reserveProductCode(tx, p.productCode);
          const created = await tx.product.create({ data: { productCode, name: p.name, unitPrice: p.unitPrice, stockQty: p.quantity } });
          if (p.quantity > 0) {
            await tx.stockMovement.create({
              data: {
                productId: created.id,
                change: p.quantity,
                type: "RECEIVE",
                reason: "Bulk upload — opening stock",
                supplierRef: supplierRef || null,
                staffId: user.id,
              },
            });
          }
          out.push({ row: p.row, action: "CREATE", productId: created.id, productCode: created.productCode, productName: created.name, newStockQty: created.stockQty });
        }
      }
      return out;
    }, { timeout: 60_000, maxWait: 10_000 });

    const body: BulkReceiveResponse = { results };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
