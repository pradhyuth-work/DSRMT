import { SELLER } from "@/lib/seller";
import { LOGO_PNG_BASE64 } from "@/lib/logo-data";
import { A5, PdfPage, buildPdf, fit, textWidth } from "@/lib/pdf";
import { f2, ist, type loadInvoiceView } from "@/lib/invoice-view";
import { pngToGray } from "@/lib/png";

type View = Awaited<ReturnType<typeof loadInvoiceView>>;

const M = 28;
const R = A5.w - M; // right edge
const ROW_H = 14;
const ROWS_FIRST = 15; // rows that fit between the table header and the footer block
const ROWS_WITH_IRN = 10; // rows on the last page when it also carries the QR code and IRN

/** Word-wraps to the given width, at most `maxLines` lines. */
function wrap(s: string, size: number, width: number, maxLines: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const t = cur ? `${cur} ${w}` : w;
    if (textWidth(t, size) <= width || !cur) cur = t;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.slice(0, maxLines);
}

function header(pg: PdfPage, v: View, logo: boolean) {
  const { inv, o, pos, stateName, addr, ship, when } = v;
  if (logo) pg.image(M, 28, 40, 40);
  pg.text(M + 50, 44, "VARASIDHI ENTERPRISES", 16, { bold: true });
  pg.text(M + 50, 54, `${SELLER.addr1}, ${SELLER.addr2},`, 6.5, { gray: true });
  pg.text(M + 50, 62, `${SELLER.location} ${SELLER.pincode}`, 6.5, { gray: true });
  pg.text(M + 50, 71, `GSTIN: ${SELLER.gstin}`, 7, { bold: true });
  pg.text(R, 40, "TAX INVOICE", 12, { bold: true, align: "right" });
  pg.text(R, 49, "ORIGINAL FOR RECIPIENT", 6, { align: "right", gray: true });
  pg.line(M, 80, R, 80, 1.5);

  pg.text(M, 89, "INVOICE NO", 5.5, { gray: true });
  pg.text(M + 130, 89, "INVOICE DATE", 5.5, { gray: true });
  pg.text(M + 250, 89, "PLACE OF SUPPLY", 5.5, { gray: true });
  pg.text(M, 101, v.invoiceNumber, 11, { bold: true });
  pg.text(M + 130, 101, ist(when, false), 10, { bold: true });
  pg.text(M + 250, 101, `${pos}${stateName ? ` - ${stateName}` : ""}`, 8.5, { bold: true });
  pg.line(M, 107, R, 107, 0.5, true);

  const c2 = [M, M + 95, M + 210, M + 275];
  ["VEHICLE NO", "DATE & TIME OF SUPPLY", "REVERSE CHARGE", "REP"].forEach((l, i) => pg.text(c2[i], 115, l, 5.5, { gray: true }));
  pg.text(c2[0], 125, inv.vehicleNo ?? "", 8, { bold: true });
  pg.text(c2[1], 125, ist(when, true), 8, { bold: true });
  pg.text(c2[2], 125, "No", 8, { bold: true });
  pg.text(c2[3], 125, fit(inv.staff?.name ?? "", 8, R - c2[3], true), 8, { bold: true });
  pg.line(M, 131, R, 131, 0.5, true);

  [M, M + 185].forEach((x, i) => {
    pg.text(x, 139, i === 0 ? "BILLED TO" : "SHIPPED TO", 5.5, { gray: true });
    const nm = i === 0 ? o.name : ship.name;
    pg.text(x, 149, fit(nm, 9, 170, true), 9, { bold: true });
    wrap(i === 0 ? addr : ship.addr, 7, 170, 2).forEach((ln, k) => pg.text(x, 158 + k * 8, ln, 7));
    if (o.gstNumber) pg.text(x, 176, `GSTIN: ${o.gstNumber}`, 7, { bold: true });
  });
  pg.line(M, 184, R, 184, 0.5, true);

  // table header
  pg.line(M, 192, R, 192, 1.2);
  const y = 200;
  pg.text(M, y, "#", 6, { bold: true });
  pg.text(M + 12, y, "DESCRIPTION", 6, { bold: true });
  pg.text(M + 132, y, "HSN", 6, { bold: true });
  const right: [string, number][] = [["PKNG", 186], ["M.R.P", 216], ["QTY", 240], ["FREE", 260], ["RATE", 294], ["GST%", 318], ["AMOUNT", R - M]];
  right.forEach(([l, x]) => pg.text(M + x, y, l, 6, { bold: true, align: "right" }));
  pg.line(M, 205, R, 205, 1.2);
}

function lines(pg: PdfPage, v: View, from: number, to: number) {
  v.rows.slice(from, to).forEach((r, i) => {
    const y = 217 + i * ROW_H;
    pg.text(M, y, String(r.n), 7, { gray: true });
    pg.text(M + 12, y, fit(r.name, 7.5, 114, true), 7.5, { bold: true });
    pg.text(M + 132, y, r.hsn, 7);
    pg.text(M + 186, y, r.pk, 7, { align: "right" });
    pg.text(M + 216, y, f2(r.mrp), 7, { align: "right" });
    pg.text(M + 240, y, String(r.qty), 7, { align: "right" });
    pg.text(M + 260, y, "0", 7, { align: "right" });
    pg.text(M + 294, y, f2(r.rate), 7, { align: "right" });
    pg.text(M + 318, y, String(r.gst), 7, { align: "right" });
    pg.text(R, y, f2(r.amt), 7.5, { bold: true, align: "right" });
    pg.line(M, y + 5, R, y + 5, 0.3, true);
  });
}

/** QR code, IRN and e-way bill, above the totals on the last page. */
function irnBlock(pg: PdfPage, v: View, hasQr: boolean) {
  const e = v.einv!;
  const x = hasQr ? M + 92 : M;
  // As large as the space allows: the signed code is dense.
  if (hasQr) pg.qr(M, 363, 85);
  if (!hasQr) pg.text(M, 441, "QR code could not be drawn here: use Print.", 5.5, { gray: true });
  pg.text(x, 374, e.test ? "TEST ONLY - NOT A VALID E-INVOICE" : "E-INVOICE", e.test ? 9 : 6, { bold: true, gray: !e.test });
  const field = (label: string, val: string, y: number) => { pg.text(x, y, label, 5.5, { gray: true }); pg.text(x, y + 8, fit(val, 6.5, R - x, true), 6.5, { bold: true }); };
  field("IRN", e.irn, 384);
  field("ACK NO / DATE", [e.ackNo, e.ackDate].filter(Boolean).join("   "), 403);
  if (e.ewb) field("E-WAY BILL NO / DATE / VALID UPTO", [e.ewb.no, e.ewb.date, e.ewb.validUpto].filter(Boolean).join("   "), 422);
}

function footer(pg: PdfPage, v: View) {
  const { intra, slabs, sumTax, half, subTotal, discount, round, net, rows, sumQty, mrpValue } = v;
  pg.line(M, 450, R, 450, 1.5);
  const cx = intra ? [M, M + 28, M + 78, M + 108, M + 156, M + 186] : [M, M + 28, M + 78, M + 108];
  const heads = intra ? ["GST %", "SALE VAL", "SGST %", "SGST AMT", "CGST %", "CGST AMT"] : ["GST %", "SALE VAL", "IGST %", "IGST AMT"];
  heads.forEach((h, i) => pg.text(cx[i], 459, h, 5.5, { bold: true, gray: true }));
  pg.line(M, 462, M + 225, 462, 0.4, true);
  slabs.forEach((x, k) => {
    const vals = intra
      ? [`${x.rate}.0`, f2(x.saleVal), String(x.rate / 2), f2(x.half), String(x.rate / 2), f2(x.tax - x.half)]
      : [`${x.rate}.0`, f2(x.saleVal), String(x.rate), f2(x.tax)];
    vals.forEach((t, i) => pg.text(cx[i], 471 + k * 9, t, 7));
  });
  const dy = Math.max(0, slabs.length - 1) * 9;
  pg.text(M, 487 + dy, `TOT ITEMS: ${rows.length}   TOT QTY: ${sumQty}   MRP VALUE: ${f2(mrpValue)}`, 6.5, { bold: true });
  pg.text(M, 503 + dy, "TERMS", 5.5, { gray: true });
  pg.text(M, 512 + dy, "Goods once sold will not be returned.", 7);

  const L = M + 240;
  const tl = (label: string, val: string, y: number) => { pg.text(L, y, label, 7); pg.text(R, y, val, 7, { align: "right" }); };
  let y = 459;
  tl("SUB TOTAL", f2(subTotal), y); y += 9;
  if (intra) { tl("SGST AMT", f2(half), y); y += 9; tl("CGST AMT", f2(sumTax - half), y); y += 9; }
  else { tl("IGST AMT", f2(sumTax), y); y += 9; }
  if (discount > 0) { tl("LESS: DISCOUNT", `-${f2(discount)}`, y); y += 9; }
  tl("ROUND OFF", f2(round), y);
  pg.rect(L, 508, R - L, 24, 1.2);
  pg.text(L + 6, 523, "NET AMT", 6.5, { bold: true });
  pg.text(R - 6, 524, `Rs ${f2(net)}`, 12.5, { bold: true, align: "right" });
  pg.text(R, 546, "For VARASIDHI ENTERPRISES", 7.5, { bold: true, align: "right" });
  pg.line(L, 565, R, 565, 0.5, true);
  pg.text(R, 573, "AUTHORISED SIGNATORY", 5.5, { align: "right", gray: true });
}

function buildPages(v: View, hasQr: boolean): PdfPage[] {
  const pages: PdfPage[] = [];
  const total = v.rows.length;
  const lastCap = v.einv ? ROWS_WITH_IRN : ROWS_FIRST;
  let from = 0;
  for (;;) {
    const pg = new PdfPage();
    header(pg, v, true);
    const left = total - from;
    const last = left <= lastCap;
    // An earlier page keeps at least one line back, so the last page is never empty.
    const to = from + (last ? left : Math.min(ROWS_FIRST, left - 1));
    lines(pg, v, from, to);
    from = to;
    pages.push(pg);
    if (last) break;
  }
  // Pages can be saved and sent one by one, so each says which it is.
  if (pages.length > 1) pages.forEach((pg, i) => pg.text(R, 58, `PAGE ${i + 1} OF ${pages.length}`, 6, { bold: true, align: "right" }));
  const end = pages[pages.length - 1];
  if (v.einv) irnBlock(end, v, hasQr);
  footer(end, v);
  return pages;
}

const qrImage = (v: View) => (v.einv?.qr ? pngToGray(Buffer.from(v.einv.qr, "base64")) : null);

/** The invoice pages as plain drawing commands (A5 points, y from the top) for painting on a canvas. */
export function invoiceLayout(v: View) {
  const qr = v.einv?.qr ? `data:image/png;base64,${v.einv.qr}` : null;
  return { w: A5.w, h: A5.h, qr, pages: buildPages(v, qr !== null).map((p) => p.cmds) };
}

export function renderInvoicePdf(v: View): Buffer {
  const qr = qrImage(v);
  const pages = buildPages(v, qr !== null);
  return buildPdf(pages, Buffer.from(LOGO_PNG_BASE64, "base64"), v.invoiceNumber, qr);
}
