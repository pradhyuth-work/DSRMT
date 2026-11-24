import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, TRANSACTION_TIMEOUT_MS, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { posBillSchema } from "@/lib/validation";
import { orderInclude, toOrderDTO } from "@/lib/orders";
import { allocateNumber } from "@/lib/invoice-series";
import { computeLine } from "@/lib/gst";
import { round2 } from "@/lib/money";
import type { OrderDTO } from "@/lib/types";

/**
 * POS bill (admin only): a walk-in or a new outlet, prices typed by hand (no minimum price), tax option
 * chosen per bill. Makes a billed, handed-over GST invoice with the next MTR number, takes stock out, and
 * keeps a tax snapshot per line. A new outlet is created on the spot and stays "pending review".
 * No GSTIN means a B2C bill: no e-invoice. A GSTIN's own state decides the place of supply.
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin"]);
    const input = await parseBody(req, posBillSchema);

    const needed = new Map<string, number>();
    for (const it of input.items) needed.set(it.productId, (needed.get(it.productId) ?? 0) + it.quantity);
    const productIds = [...needed.keys()].sort();

    const order = await prisma.$transaction(async (tx) => {
      // Outlet: existing, or a new one waiting for review.
      let outletId = input.outletId;
      let gstin: string | null = null;
      if (outletId) {
        const o = await tx.outlet.findUnique({ where: { id: outletId }, select: { gstNumber: true } });
        if (!o) throw new HttpError(404, "Outlet not found");
        gstin = o.gstNumber;
      } else {
        const n = input.newOutlet!;
        gstin = n.gstNumber ?? null;
        const created = await tx.outlet.create({
          data: { name: n.name, phone: n.phone ?? "", address: n.address ?? "", gstNumber: gstin, city: n.city ?? null, pincode: n.pincode ?? null, pendingReview: true },
        });
        outletId = created.id;
      }
      const placeOfSupply = gstin && /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : input.placeOfSupply ?? "29";

      const stock = await tx.$queryRaw<{ id: string; name: string; stockQty: number; unitPrice: number; mrp: number | null; hsnCode: string | null; gstRate: number }[]>`
        SELECT "id", "name", "stockQty", "unitPrice", "mrp", "hsnCode", "gstRate" FROM "Product"
        WHERE "id" IN (${Prisma.join(productIds)})
        ORDER BY "id"
        FOR UPDATE`;
      const byId = new Map(stock.map((p) => [p.id, p]));
      for (const pid of productIds) if (!byId.has(pid)) throw new HttpError(404, "A product on this bill no longer exists");
      const shortages = stock.filter((p) => p.stockQty < needed.get(p.id)!).map((p) => `${p.name} (need ${needed.get(p.id)}, have ${p.stockQty})`);
      if (shortages.length > 0) throw new HttpError(400, `Not enough stock: ${shortages.join(", ")}`);

      const lines = input.items.map((it) => {
        const p = byId.get(it.productId)!;
        const mrp = it.mrp ?? p.mrp;
        const t = computeLine(it.taxMode ?? input.taxMode, it.price, it.quantity, p.gstRate, mrp ?? null);
        if (!t) throw new HttpError(400, `${p.name}: enter the MRP for the "Inclusive on MRP" option`);
        return { it, p, mrp: mrp ?? null, t };
      });
      // Bill-level label: MRP if any line is on MRP (that is what drives the discount line), else the common option.
      const modes = new Set(input.items.map((it) => it.taxMode ?? input.taxMode));
      const billMode = modes.has("MRP") ? "MRP" : modes.size === 1 ? [...modes][0] : "INCLUSIVE";
      const total = Math.round(lines.reduce((s, l) => s + l.t.gross, 0));
      const invoiceNumber = await allocateNumber(tx);
      const now = new Date();

      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          outletId: outletId!,
          staffId: user.id,
          totalAmount: total,
          paidAmount: 0,
          balanceDue: round2(total),
          status: "UNPAID",
          fulfilmentStatus: "DISPATCHED",
          billedAt: now,
          billedById: user.id,
          dispatchedAt: now,
          dispatchedById: user.id,
          billedOutside: false,
          posBill: true,
          taxMode: billMode,
          placeOfSupply,
          items: {
            create: lines.map((l) => ({
              productId: l.it.productId,
              quantity: l.it.quantity,
              unitPrice: l.it.price,
              subtotal: l.t.gross,
              hasScheme: false,
              listUnitPrice: l.p.unitPrice,
              mrp: l.mrp,
              hsnCode: l.p.hsnCode,
              gstRate: l.p.gstRate,
              taxable: l.t.taxable,
              taxAmt: l.t.tax,
            })),
          },
        },
        include: orderInclude,
      });

      const stockRows = productIds.map((pid) => Prisma.sql`(${pid}::text, ${needed.get(pid)!}::int)`);
      await tx.$executeRaw`
        UPDATE "Product" AS p SET "stockQty" = p."stockQty" - v.qty
        FROM (VALUES ${Prisma.join(stockRows)}) AS v(id, qty) WHERE p."id" = v.id`;
      await tx.stockMovement.createMany({
        data: productIds.map((pid) => ({ productId: pid, change: -needed.get(pid)!, type: "BILL" as const, invoiceId: invoice.id, staffId: user.id })),
      });
      return invoice;
    }, { timeout: TRANSACTION_TIMEOUT_MS });

    const body: OrderDTO = toOrderDTO(order);
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
