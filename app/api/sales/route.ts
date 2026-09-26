import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse, parseBody } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { createSaleSchema } from "@/lib/validation";
import { round2, statusFor } from "@/lib/money";
import { nextInvoiceId, priceLines } from "@/lib/orders";
import type { CreateSaleResponse } from "@/lib/types";

/**
 * Creates an order (invoice) in PENDING state. Stock is checked here but only deducted
 * when the order is dispatched (POST /api/orders/:id/dispatch).
 * Agents always own the orders they create; admins choose the owning staff member.
 */
export async function POST(req: Request) {
  try {
    const user = await authorize(req, ["admin", "agent"]);
    const input = await parseBody(req, createSaleSchema);

    const staffId = user.role === "agent" ? user.id : input.staffId;
    if (!staffId) throw new HttpError(400, "staffId: Select the staff member for this order");

    const invoice = await prisma.$transaction(async (tx) => {
      const [outlet, staff] = await Promise.all([
        tx.outlet.findUnique({ where: { id: input.outletId }, select: { id: true, agentId: true } }),
        tx.staff.findUnique({ where: { id: staffId }, select: { id: true } }),
      ]);
      if (!outlet) throw new HttpError(400, "Outlet not found");
      if (!staff) throw new HttpError(400, "Staff member not found");
      // Agents can only order for outlets assigned to them; admins aren't restricted.
      if (user.role === "agent" && outlet.agentId !== user.id) {
        throw new HttpError(403, "This outlet isn't assigned to you");
      }

      const { lines, totalAmount } = await priceLines(tx, input.items, user.role);
      const paidAmount = round2(input.paidAmount);
      if (paidAmount > totalAmount) {
        throw new HttpError(400, `Payment (${paidAmount}) exceeds invoice total (${totalAmount})`);
      }
      const balanceDue = round2(totalAmount - paidAmount);

      const created = await tx.invoice.create({
        data: {
          id: await nextInvoiceId(tx),
          outletId: input.outletId,
          staffId,
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
            staffId,
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
        fulfilmentStatus: invoice.fulfilmentStatus,
        createdAt: invoice.createdAt.toISOString(),
        items: invoice.lines,
      },
    };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
