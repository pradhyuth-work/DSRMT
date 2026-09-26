import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { createSaleSchema } from "@/lib/validation";
import { round2, statusFor } from "@/lib/money";
import type { CreateSaleResponse } from "@/lib/types";

const INVOICE_PREFIX = "INV-";
const FIRST_INVOICE_NUMBER = 1001;

async function nextInvoiceId(tx: Prisma.TransactionClient): Promise<string> {
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

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSaleSchema);

    // Merge duplicate lines for the same product so the stock check is accurate.
    const quantities = new Map<string, number>();
    for (const item of input.items) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }

    const invoice = await prisma.$transaction(async (tx) => {
      const [outlet, staff] = await Promise.all([
        tx.outlet.findUnique({ where: { id: input.outletId }, select: { id: true } }),
        tx.staff.findUnique({ where: { id: input.staffId }, select: { id: true } }),
      ]);
      if (!outlet) throw new HttpError(400, "Outlet not found");
      if (!staff) throw new HttpError(400, "Staff member not found");

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

      const totalAmount = round2(lines.reduce((sum, l) => sum + l.subtotal, 0));
      const paidAmount = round2(input.paidAmount);
      if (paidAmount > totalAmount) {
        throw new HttpError(400, `Payment (${paidAmount}) exceeds invoice total (${totalAmount})`);
      }
      const balanceDue = round2(totalAmount - paidAmount);

      // Conditional decrement: fails if another request consumed the stock since we read it.
      for (const line of lines) {
        const { count } = await tx.product.updateMany({
          where: { id: line.productId, stockQty: { gte: line.quantity } },
          data: { stockQty: { decrement: line.quantity } },
        });
        if (count === 0) throw new HttpError(400, `Insufficient stock for ${line.productName}`);
      }

      const created = await tx.invoice.create({
        data: {
          id: await nextInvoiceId(tx),
          outletId: input.outletId,
          staffId: input.staffId,
          totalAmount,
          paidAmount,
          balanceDue,
          status: statusFor(totalAmount, paidAmount),
          items: {
            create: lines.map(({ productId, quantity, unitPrice, subtotal }) => ({
              productId,
              quantity,
              unitPrice,
              subtotal,
            })),
          },
        },
      });

      if (paidAmount > 0) {
        await tx.paymentCollection.create({
          data: {
            outletId: input.outletId,
            staffId: input.staffId,
            invoiceId: created.id,
            amount: paidAmount,
            paymentMethod: input.paymentMethod,
            notes: input.notes || "Payment at time of sale",
          },
        });
      }

      return { ...created, lines };
    });

    const body: CreateSaleResponse = {
      invoice: {
        id: invoice.id,
        totalAmount: invoice.totalAmount,
        paidAmount: invoice.paidAmount,
        balanceDue: invoice.balanceDue,
        status: invoice.status,
        createdAt: invoice.createdAt.toISOString(),
        items: invoice.lines,
      },
    };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
