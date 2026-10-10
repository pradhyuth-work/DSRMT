import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { bulkReceiveSchema } from "@/lib/validation";
import { round2 } from "@/lib/money";
import { reserveProductCode } from "@/lib/product-codes";
import type { BulkReceiveResponse, BulkReceiveResultRow } from "@/lib/types";

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Bulk stock-inwarding upload (CSV or the in-app grid both post the same row shape here).
 * Admin only — receiving stock is now exclusively an admin action.
 *
 * Each row either tops up an existing product (matched by name, case-insensitively) or, when
 * no product has that name, creates a new one at the next free product code. All rows are resolved and
 * validated first; if any row has a problem, nothing is written — the whole upload is
 * rejected with every row's error so it can be fixed and resubmitted, rather than applying
 * part of a batch.
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin"]);
    const { rows, supplierRef } = await parseBody(req, bulkReceiveSchema);

    const results = await prisma.$transaction(async (tx) => {
      const existingByName = new Map(
        (await tx.product.findMany({ select: { id: true, name: true } })).map((p) => [nameKey(p.name), p]),
      );

      const errors: { row: number; error: string }[] = [];
      const plan: (
        | { row: number; action: "RESTOCK"; productId: string; quantity: number }
        | { row: number; action: "CREATE"; name: string; unitPrice: number; quantity: number }
      )[] = [];

      rows.forEach((r, i) => {
        const rowNum = i + 1;
        const existing = existingByName.get(nameKey(r.name));

        if (existing) {
          plan.push({ row: rowNum, action: "RESTOCK", productId: existing.id, quantity: r.quantity });
          return;
        }

        if (r.unitPrice === undefined) {
          errors.push({
            row: rowNum,
            error: `"${r.name}" isn't an existing product — give a unit price to create it, or check the spelling to restock an existing one`,
          });
          return;
        }
        plan.push({ row: rowNum, action: "CREATE", name: r.name, unitPrice: round2(r.unitPrice), quantity: r.quantity });
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
          const productCode = await reserveProductCode(tx, undefined);
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
