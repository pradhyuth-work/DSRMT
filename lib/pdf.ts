// Minimal, dependency-free PDF writer — just enough for the A5 tax invoice: text in Helvetica / Helvetica-Bold,
// lines, rectangles, one PNG image, several pages. (Same spirit as lib/xlsx.ts.)
import { deflateSync } from "node:zlib";
import { HELV, HELV_BOLD } from "@/lib/pdf-fonts";

export const A5 = { w: 419.53, h: 595.28 };

export function textWidth(s: string, size: number, bold = false): number {
  const t = bold ? HELV_BOLD : HELV;
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? t[c - 32] : 556;
  }
  return (w * size) / 1000;
}

/** Cuts a string with "..." so it fits in `max` points. */
export function fit(s: string, size: number, max: number, bold = false): string {
  if (textWidth(s, size, bold) <= max) return s;
  let t = s;
  while (t.length > 1 && textWidth(t + "...", size, bold) > max) t = t.slice(0, -1);
  return t + "...";
}

const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** Same drawing as `ops`, but as plain data, so the invoice can also be painted on a canvas and saved as an image. */
export type DrawCmd =
  | { t: "text"; x: number; y: number; s: string; size: number; bold: boolean; right: boolean; gray: boolean }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; width: number; gray: boolean }
  | { t: "rect"; x: number; y: number; w: number; h: number; width: number }
  | { t: "image"; x: number; y: number; w: number; h: number };

export class PdfPage {
  ops: string[] = [];
  cmds: DrawCmd[] = [];
  /** y is measured from the TOP of the page, like on screen. */
  text(x: number, y: number, s: string, size = 8, o: { bold?: boolean; align?: "left" | "right"; gray?: boolean } = {}) {
    this.cmds.push({ t: "text", x, y, s, size, bold: !!o.bold, right: o.align === "right", gray: !!o.gray });
    const w = textWidth(s, size, o.bold);
    const px = o.align === "right" ? x - w : x;
    const c = o.gray ? "0.35 0.42 0.42 rg" : "0.06 0.17 0.16 rg";
    this.ops.push(`BT ${c} /${o.bold ? "F2" : "F1"} ${n(size)} Tf ${n(px)} ${n(A5.h - y)} Td (${esc(s)}) Tj ET`);
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = false) {
    this.cmds.push({ t: "line", x1, y1, x2, y2, width, gray });
    this.ops.push(`${gray ? "0.78 0.83 0.82" : "0.06 0.17 0.16"} RG ${n(width)} w ${n(x1)} ${n(A5.h - y1)} m ${n(x2)} ${n(A5.h - y2)} l S`);
  }
  rect(x: number, y: number, w: number, h: number, width = 1) {
    this.cmds.push({ t: "rect", x, y, w, h, width });
    this.ops.push(`0.06 0.17 0.16 RG ${n(width)} w ${n(x)} ${n(A5.h - y - h)} ${n(w)} ${n(h)} re S`);
  }
  image(x: number, y: number, w: number, h: number) {
    this.cmds.push({ t: "image", x, y, w, h });
    this.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(A5.h - y - h)} cm /Im1 Do Q`);
  }
}

/** Reads width/height and the raw IDAT stream of a non-interlaced 8-bit RGB PNG so it can go into a PDF as-is. */
function pngForPdf(png: Buffer) {
  let p = 8;
  let width = 0, height = 0;
  const idat: Buffer[] = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString("latin1", p + 4, p + 8);
    const data = png.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  return { width, height, data: Buffer.concat(idat) };
}

export function buildPdf(pages: PdfPage[], logoPng: Buffer, title: string): Buffer {
  const img = pngForPdf(logoPng);
  const objs: Buffer[] = [];
  const add = (b: string | Buffer) => { objs.push(Buffer.isBuffer(b) ? b : Buffer.from(b, "latin1")); return objs.length; };
  // 1 catalog, 2 pages (filled in below), 3-4 fonts, 5 image, 6 info, then content+page pairs
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages placeholder
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  add(Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${img.width} >> /Length ${img.data.length} >>\nstream\n`, "latin1"),
    img.data, Buffer.from("\nendstream", "latin1"),
  ]));
  add(`<< /Title (${esc(title)}) /Producer (Varasidhi DSRMT) >>`);
  const kids: number[] = [];
  for (const pg of pages) {
    const stream = deflateSync(Buffer.from(pg.ops.join("\n"), "latin1"));
    const c = add(Buffer.concat([Buffer.from(`<< /Filter /FlateDecode /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]));
    const pgObj = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(A5.w)} ${n(A5.h)}] /Contents ${c} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >> >>`);
    kids.push(pgObj);
  }
  objs[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`, "latin1");

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), o, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(b);
    pos += b.length;
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}
