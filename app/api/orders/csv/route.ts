import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, csvResponse, errorResponse, toCsv } from "@/lib/api";
import { ALL_ROLES, authorize } from "@/lib/auth";
import { orderInclude, toOrderDTO } from "@/lib/orders";
import { formatMoney, splitBasicAndGst } from "@/lib/money";
import type { FulfilmentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: FulfilmentStatus[] = ["PENDING", "BILLED", "DISPATCHED", "CANCELLED"];

/**
 * Downloads the currently-filtered orders list as CSV — same ?status= filter as GET
 * /api/orders (omit it for every status, matching the "All" chip). Agents only ever see
 * their own orders, same scoping as the list view.
 */
export async function GET(req: Request) {
  try {
    const user = await authorize(req, ALL_ROLES);
    const status = new URL(req.url).searchParams.get("status");
    if (status && !STATUSES.includes(status as FulfilmentStatus)) {
      throw new HttpError(400, `status must be one of ${STATUSES.join(", ")}`);
    }

    const where: Prisma.InvoiceWhereInput = {
      fulfilmentStatus: (status as FulfilmentStatus | null) ?? undefined,
      staffId: user.role === "agent" ? user.id : undefined,
    };
    const orders = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: orderInclude,
    }).then((rows) => rows.map(toOrderDTO));

    const csv = toCsv(
      ["Date", "Bill #", "Outlet", "Staff", "Fulfilment", "Payment Status", "Items", "Basic Price", "GST", "Total", "Paid", "Balance"],
      orders.map((o) => {
        const { basic, gst } = splitBasicAndGst(o.totalAmount);
        return [
          new Date(o.createdAt).toLocaleString("en-IN"),
          o.invoiceNumber ?? "Not billed",
          o.outletName,
          o.staffName,
          o.fulfilmentStatus,
          o.status,
          o.items.map((i) => `${i.quantity}x ${i.productName}`).join("; "),
          formatMoney(basic),
          formatMoney(gst),
          formatMoney(o.totalAmount),
          formatMoney(o.paidAmount),
          formatMoney(o.balanceDue),
        ];
      }),
    );

    return csvResponse(csv, `orders-${status ?? "all"}.csv`);
  } catch (err) {
    return errorResponse(err);
  }
}
