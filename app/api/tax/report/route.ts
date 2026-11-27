import { errorResponse, HttpError, csvResponse, toCsv } from "@/lib/api";
import { authorize } from "@/lib/auth";
import { STYLE, buildXlsx, newSheet, setCell } from "@/lib/xlsx";
import {
  REPORT_TYPES, cancelledTable, einvoiceStatusTable, gstr1Tables, gstr3bTable, hsnTable, loadMonth, salesRegisterTable,
  type ReportType, type Table,
} from "@/lib/tax-reports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function toXlsx(tables: Table[]): ArrayBuffer {
  const sheets = tables.map((t) => {
    const sh = newSheet(t.name);
    t.header.forEach((h, c) => { setCell(sh, c + 1, 1, { v: h, s: STYLE.HEADER }); sh.colWidths.set(c + 1, 18); });
    t.rows.forEach((r, ri) => r.forEach((v, c) => setCell(sh, c + 1, ri + 2, { v, s: typeof v === "number" ? STYLE.NUM : STYLE.TEXT })));
    sh.freeze = "A2";
    return sh;
  });
  const bytes = buildXlsx(sheets);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Tax reports for the CA / the portal, from invoices made in the app (MTR series).
 *   ?type=gstr1|gstr3b|sales-register|hsn|einvoice-status|cancelled  &month=YYYY-MM
 *   &format=json  returns the tables for viewing on screen; otherwise a download
 *                 (GSTR-1 is an .xlsx workbook, everything else a CSV).
 * Admin only.
 */
export async function GET(req: Request) {
  try {
    await authorize(req, ["admin"]);
    const url = new URL(req.url);
    const type = url.searchParams.get("type") as ReportType | null;
    const month = url.searchParams.get("month") ?? "";
    if (!type || !REPORT_TYPES.includes(type)) throw new HttpError(400, `type must be one of ${REPORT_TYPES.join(", ")}`);

    let tables: Table[];
    if (type === "cancelled") {
      tables = [await cancelledTable(month)];
    } else {
      const { live, cancelled } = await loadMonth(month);
      tables =
        type === "gstr1" ? gstr1Tables(live, cancelled).tables
        : type === "gstr3b" ? [gstr3bTable(live)]
        : type === "sales-register" ? [salesRegisterTable(live)]
        : type === "hsn" ? [hsnTable(live)]
        : [await einvoiceStatusTable(live)];
    }

    if (url.searchParams.get("format") === "json") return Response.json({ tables });
    if (type === "gstr1") {
      return new Response(toXlsx(tables), {
        headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="GSTR1-${month}.xlsx"` },
      });
    }
    const t = tables[0];
    return csvResponse(toCsv(t.header, t.rows), `${type}-${month}.csv`);
  } catch (err) {
    return errorResponse(err);
  }
}
