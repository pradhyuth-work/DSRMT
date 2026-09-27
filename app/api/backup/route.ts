import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Downloads every core table as one JSON file. Admin only. Staff rows exclude
 * passwordHash and tokenVersion — a backup file is something that gets emailed around and
 * saved to a laptop, and a password hash has no business leaving the database for that.
 */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);

    const [staff, products, routes, outlets, invoices, invoiceItems, payments, stockMovements] = await Promise.all([
      prisma.staff.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, phone: true, username: true, role: true, active: true, createdAt: true },
      }),
      prisma.product.findMany({ orderBy: { productCode: "asc" } }),
      prisma.route.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.outlet.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.invoice.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.invoiceItem.findMany({ orderBy: { id: "asc" } }),
      prisma.paymentCollection.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.stockMovement.findMany({ orderBy: { createdAt: "asc" } }),
    ]);

    const backup = {
      format: "dsrmt-backup",
      version: 1,
      generatedAt: new Date().toISOString(),
      rowCounts: {
        staff: staff.length,
        products: products.length,
        routes: routes.length,
        outlets: outlets.length,
        invoices: invoices.length,
        invoiceItems: invoiceItems.length,
        payments: payments.length,
        stockMovements: stockMovements.length,
      },
      tables: { staff, products, routes, outlets, invoices, invoiceItems, payments, stockMovements },
    };

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="dsrmt-backup-${stamp}.json"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
