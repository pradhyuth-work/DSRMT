import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError, errorResponse } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { buildEinvoice, einvoiceInclude } from "@/lib/einvoice";
import type { EinvoiceReportDTO } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * E-invoice JSON for bills made in the app, one or many.
 *   ?ids=a,b,c          specific orders
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   billed in that range (India dates, inclusive)
 *   ?only=new           only bills not exported before
 *   ?format=report      JSON summary of what is ready / blocked and why (nothing is marked)
 *   (default)           a downloadable JSON array, the shape the IRP bulk-upload tool takes;
 *                       bills that are ready are marked as exported, blocked ones are left out
 * Admin only. Bills made outside the app, cancelled, or to outlets with no GSTIN are never included.
 */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const url = new URL(req.url);
    const ids = url.searchParams.get("ids")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const onlyNew = url.searchParams.get("only") === "new";
    const report = url.searchParams.get("format") === "report";

    const where: Prisma.InvoiceWhereInput = {
      billedOutside: false,
      invoiceNumber: { not: null },
      fulfilmentStatus: { not: "CANCELLED" },
    };
    if (ids.length > 0) where.id = { in: ids.slice(0, 500) };
    if (from || to) {
      const range: Prisma.DateTimeNullableFilter = {};
      if (from) range.gte = new Date(`${from}T00:00:00+05:30`);
      if (to) range.lt = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000);
      if ((range.gte && Number.isNaN(range.gte.getTime())) || (range.lt instanceof Date && Number.isNaN(range.lt.getTime()))) {
        throw new HttpError(400, "Dates must be YYYY-MM-DD");
      }
      where.billedAt = range;
    }
    if (onlyNew) where.einvExportedAt = null;
    if (ids.length === 0 && !from && !to) throw new HttpError(400, "Choose bills or a date range");

    const invoices = await prisma.invoice.findMany({ where, include: einvoiceInclude, orderBy: { billedAt: "asc" }, take: 1000 });
    const results = invoices.map((inv) => ({ inv, res: buildEinvoice(inv) }));

    if (report) {
      const body: EinvoiceReportDTO = {
        ready: results.filter((r) => r.res.json).length,
        blocked: results.filter((r) => !r.res.json).length,
        rows: results.map((r) => ({
          invoiceNumber: r.res.invoiceNumber,
          ready: r.res.json !== null,
          errors: r.res.errors,
          warnings: r.res.warnings,
        })),
      };
      return NextResponse.json(body);
    }

    const ready = results.filter((r) => r.res.json);
    if (ready.length === 0) throw new HttpError(400, "No bill is ready for an e-invoice — check the report for what is missing");
    await prisma.invoice.updateMany({ where: { id: { in: ready.map((r) => r.inv.id) } }, data: { einvExportedAt: new Date() } });

    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    return new Response(JSON.stringify(ready.map((r) => r.res.json), null, 1), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="einvoice-${ready.length}-bills-${stamp}.json"`,
        "X-Einvoice-Blocked": String(results.length - ready.length),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
