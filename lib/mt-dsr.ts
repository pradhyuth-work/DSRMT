// Builds the monthly "MT DSR" Excel workbook (the one that used to be filled by hand from
// Target / CSV exports): a "FA-Outlet Wise Sale" sheet with one row per billed invoice, and a
// "WD DSR" sheet with the day-by-day stock block (opening / sale / primary / closing) per SKU.
// Pure functions only — the database reads live in lib/mt-dsr-data.ts, so this can be
// exercised with fixtures (scripts/test-mt-dsr.ts).

import { STYLE, buildXlsx, colIndex, colLetter, excelSerial, newSheet, setCell, type Sheet } from "./xlsx";

export const OUTLET_SHEET = "FA-Outlet Wise Sale ecom";
export const WD_SHEET = "WD DSR - FILE ecom";

export interface MtDsrInvoice {
  /** Billing day in India time, "YYYY-MM-DD". */
  date: string;
  /** Field agent name (the outlet's route agent). */
  fa: string;
  outlet: string;
  amount: number;
  items: { productName: string; quantity: number }[];
}

export interface MtDsrInput {
  /** Inclusive period, "YYYY-MM-DD" (India days). */
  from: string;
  to: string;
  invoices: MtDsrInvoice[];
  /** Stock on hand at the start of `from`, keyed by product name. */
  openingStock: Record<string, number>;
  /** Stock received from the company (inwarding), per day and product. */
  received: { date: string; productName: string; quantity: number }[];
}

export interface MtDsrResult {
  bytes: Uint8Array;
  invoiceCount: number;
  /** Products sold that have no column in the workbook; their quantity is in the OTHER column. */
  unmappedProducts: string[];
}

/**
 * App product name -> column on the FA-Outlet Wise Sale sheet. These are the 26 products the
 * workbook has always tracked; the WD DSR sheet uses the same columns (see wdColumnFor).
 * Names are matched ignoring case and spacing.
 */
const PRODUCT_COLUMN: Record<string, string> = {
  "Advance 10s": "X",
  "Advance 20s": "W",
  "Blue Advance 20s": "AH",
  "Clove 10s": "AE",
  "Compact 10s": "AL",
  "Filter Black 12s": "AK",
  "Fine touch 10s": "AM",
  "FS Clove Crush 64mm 10s": "N",
  "FS Crush Tropical 10s": "O",
  "Fuse 10s": "AB",
  "Fuse 20s": "AA",
  "Lights 10s": "Z",
  "Lights 20s": "Y",
  "Red 10s": "AD",
  "Red 20s": "AC",
  "Red Advance 20s": "AG",
  "Stellar CB 69mm 10s": "T",
  "Stellar Define 20s": "I", // "Stellar Define ME" column
  "Stellar Fruity Mix 10s": "S",
  "Stellar Mode On": "R",
  "Stellar Paan Mix 20s": "K",
  "Stellar Paan Pro 16s": "L",
  "Stellar Shift 20s": "F", // "Stellar Shift ME" column
  "Stellar Shift Duos 20s": "J",
  "Stellar Shift Pro 16s": "E",
  "Vista Forest 20s": "AF",
};

const normName = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const COLUMN_BY_NAME = new Map(Object.entries(PRODUCT_COLUMN).map(([name, col]) => [normName(name), col]));

const OTHER_COL = "AW";

// ---- FA-Outlet Wise Sale layout ---------------------------------------------------------------

const OUTLET_HEADERS: Record<string, string> = {
  A: "DATE", B: "FA NAME", C: "OUTLET NAME",
  D: "Stellar Shift", E: " Shift Pro", F: "Stellar Shift ME", G: "Stellar Define", H: "Define Pro", I: "Stellar Define ME",
  J: "Duos", K: "Define Paan", L: "Pan Pro", M: "FS Clove Crush", N: "FS Clove Crush 64mm", O: "FS Crush Tropical",
  P: "FS spcl", Q: "FS CRUSH MINT", R: "Stellar Mode On", S: "Stellar Fruity", T: "SCB 69MM", U: "TOT GPI", V: "m",
  W: "MLB ADV 20s", X: "MLB Adv 10s", Y: "MLB Lights 20s", Z: "MLB Lights 10s", AA: "MLB Fuse 20s", AB: "MLB Fuse 10s",
  AC: "MLB FF 20s (Red)", AD: "MLB FF 10s (Red)", AE: "MLB Clovemix", AF: "FOREST VISTA 20s", AG: "Red adv", AH: "Blue adv",
  AI: "Cav Gold Rich", AJ: "Cav Gold Smth", AK: "MLB FT Black ", AL: "MLB Compact", AM: "MLB Fine Touch",
  AN: "MLB Compact edge", AO: "Vista Double Fusion", AP: "IPM TOTAL", AQ: "m", AR: "ORANGE CANDY", AS: "IMLI 525GM",
  AT: "IMLI 770GM", AU: "IMLI MRP 30", AV: "PVSD", AW: "OTHER", AX: "BILLING VAUE", AY: "BILL  (GST/ HB)",
  AZ: "PAYMENT CHQ/CASH", BA: "STATUS",
};
const OUTLET_OUTER: Record<string, number> = {
  D: 10, E: 20, F: 10, G: 10, H: 20, I: 10, J: 10, K: 10, L: 16, M: 20, N: 20, O: 20, P: 20, Q: 20,
  W: 10, X: 20, Y: 10, Z: 20, AA: 10, AB: 20, AC: 10, AD: 20, AE: 20, AF: 10, AG: 10, AH: 10, AI: 20, AJ: 20,
  AK: 10, AL: 20, AM: 20, AN: 20, AO: 10,
};
const OUTLET_PACK: Record<string, number> = {
  D: 20, E: 16, F: 20, G: 20, H: 16, I: 20, J: 20, K: 20, L: 16, M: 10, N: 10, O: 10, P: 10, Q: 10,
  W: 20, X: 10, Y: 20, Z: 10, AA: 20, AB: 10, AC: 20, AD: 10, AE: 10, AF: 20, AG: 20, AH: 20, AI: 20, AJ: 20,
  AK: 12, AL: 10, AM: 10, AN: 10, AO: 20,
};

// Columns that hold quantities: GPI D..T, IPM W..AO.
const GPI_COLS = range(colIndex("D"), colIndex("T")).map(colLetter);
const IPM_COLS = range(colIndex("W"), colIndex("AO")).map(colLetter);
const QTY_COLS = [...GPI_COLS, ...IPM_COLS];

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The two "m" helper columns, exactly as the workbook has always computed them. */
function gpiM(q: (c: string) => number): number {
  return (q("D") + q("F") + q("G") + q("I") + q("J") + q("K") + q("M") + q("O") + q("P") + q("Q") + q("N")) / 5 + q("E") * 0.16 + q("H") * 0.16 + q("L") * 0.16;
}
function ipmM(q: (c: string) => number): number {
  const cols = ["W", "X", "Y", "Z", "AA", "AB", "AC", "AD", "AF", "AE", "AG", "AH", "AL", "AM", "AN", "AO", "AI", "AJ"];
  return sum(cols.map(q)) / 5 + q("AK") * 0.12;
}

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ---- WD DSR layout ----------------------------------------------------------------------------

const WD_HEADERS: Record<string, string> = {
  A: "DATE", C: "STK Details",
  D: "Stellar Shift", E: "Stellar shift Pro", F: "Stellar Shift ME", G: "Stellar Define", H: "Stellar define Pro",
  I: "Stellar Define ME", J: "Duos", K: "Define Paan", L: "Define pan Pro", M: "FS Clove Crush", N: "FS Clove Crush 64mm",
  O: "FS Crush Tropical", P: "FS Spcl", Q: "FS CRUSH MINT", R: "Stellar Mode On", S: "Stellar Fruity", T: "SCB 69MM",
  U: "TOT GPI", V: "MLB ADV 20s", W: "MLB Adv 10s", X: "MLB Lights 20s", Y: "MLB Lights 10s", Z: "MLB Fuse 20s",
  AA: "MLB Fuse 10s", AB: "MLB FF 20s (Red)", AC: "MLB FF 10s (Red)", AD: "FOREST VISTA 20s", AE: "MLB Clovemix",
  AF: "Red adv", AG: "Blue adv", AH: "Cav gold rich", AI: "Cav Gold smth ", AJ: "MLB FT Black ", AK: "MLB Compact",
  AL: "MLB Fine Touch", AM: "Ad Compact Edge", AN: "Vista Double Fusion", AS: "IPM TOTAL",
};

/** SKU columns on the WD DSR sheet: D..T (same as the outlet sheet) and V..AN (shifted one left, Forest/Clove swapped). */
const WD_SKU_COLS = [...range(colIndex("D"), colIndex("T")), ...range(colIndex("V"), colIndex("AN"))].map(colLetter);

/** Which FA-Outlet Wise Sale column feeds a given WD DSR column. */
function outletColumnForWd(wdCol: string): string {
  const i = colIndex(wdCol);
  if (i <= colIndex("T")) return wdCol;
  if (wdCol === "AD") return "AF"; // FOREST VISTA 20s
  if (wdCol === "AE") return "AE"; // MLB Clovemix
  return colLetter(i + 1);
}

// ---- Build ------------------------------------------------------------------------------------

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  for (let t = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function ddmmyyyy(day: string): string {
  return `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`;
}

export function buildMtDsr(input: MtDsrInput): MtDsrResult {
  const unmapped = new Set<string>();

  // Rows for the outlet sheet, oldest first.
  const invoices = [...input.invoices].sort(
    (a, b) => a.date.localeCompare(b.date) || a.fa.localeCompare(b.fa) || a.outlet.localeCompare(b.outlet),
  );
  const rowQty = invoices.map((inv) => {
    const q = new Map<string, number>();
    for (const item of inv.items) {
      let col = COLUMN_BY_NAME.get(normName(item.productName));
      if (!col) {
        col = OTHER_COL;
        unmapped.add(item.productName);
      }
      q.set(col, (q.get(col) ?? 0) + item.quantity);
    }
    return q;
  });

  const outlet = newSheet(OUTLET_SHEET);
  const FIRST = 4;
  const LAST = Math.max(FIRST, FIRST + invoices.length - 1);
  const LAST_COL = colIndex("BA");

  // Header rows 1-3.
  for (const [col, v] of Object.entries(OUTLET_OUTER)) setCell(outlet, colIndex(col), 1, { v, s: STYLE.INT });
  for (const [col, v] of Object.entries(OUTLET_PACK)) setCell(outlet, colIndex(col), 2, { v, s: STYLE.INT });
  setCell(outlet, 3, 1, { v: "Outer Size", s: STYLE.BOLD_TEXT });
  setCell(outlet, 3, 2, { v: "Pack Size", s: STYLE.BOLD_TEXT });
  for (let c = 1; c <= LAST_COL; c++) setCell(outlet, c, 3, { v: OUTLET_HEADERS[colLetter(c)] ?? "", s: STYLE.HEADER });

  invoices.forEach((inv, i) => {
    const r = FIRST + i;
    const q = rowQty[i];
    const get = (c: string) => q.get(c) ?? 0;
    for (let c = 1; c <= LAST_COL; c++) setCell(outlet, c, r, { s: STYLE.TEXT });
    setCell(outlet, 1, r, { v: excelSerial(inv.date), s: STYLE.DATE });
    setCell(outlet, 2, r, { v: inv.fa.toUpperCase(), s: STYLE.TEXT });
    setCell(outlet, 3, r, { v: inv.outlet.toUpperCase(), s: STYLE.TEXT });
    for (const col of [...QTY_COLS, OTHER_COL]) {
      const v = get(col);
      if (v) setCell(outlet, colIndex(col), r, { v, s: STYLE.INT });
    }
    setCell(outlet, colIndex("U"), r, { f: `SUM(D${r}:T${r})`, v: sum(GPI_COLS.map(get)), s: STYLE.NUM });
    setCell(outlet, colIndex("V"), r, {
      f: `((D${r}+F${r}+G${r}+I${r}+J${r}+K${r}+M${r}+O${r}+P${r}+Q${r}+N${r})/5)+E${r}*0.16+H${r}*0.16+L${r}*0.16`,
      v: round(gpiM(get)),
      s: STYLE.NUM,
    });
    setCell(outlet, colIndex("AP"), r, { f: `SUM(W${r}:AO${r})`, v: sum(IPM_COLS.map(get)), s: STYLE.NUM });
    setCell(outlet, colIndex("AQ"), r, {
      f: `((W${r}+X${r}+Y${r}+Z${r}+AA${r}+AB${r}+AC${r}+AD${r}+AF${r}+AE${r}+AG${r}+AH${r}+AL${r}+AM${r}+AN${r}+AO${r}+AI${r}+AJ${r})/5)+AK${r}*0.12`,
      v: round(ipmM(get)),
      s: STYLE.NUM,
    });
    setCell(outlet, colIndex("AX"), r, { v: Math.round(inv.amount * 100) / 100, s: STYLE.INT });
  });

  // Totals row, two rows under the data.
  const T = LAST + 2;
  setCell(outlet, 3, T, { v: "TOTAL", s: STYLE.BOLD_TEXT });
  const totalCols = [...QTY_COLS, "U", "V", "AP", "AQ", OTHER_COL, "AX"];
  for (const col of totalCols) {
    const ci = colIndex(col);
    let total = 0;
    for (let r = FIRST; r < FIRST + invoices.length; r++) {
      const cell = outlet.cells.get(`${col}${r}`);
      if (cell && typeof cell.v === "number") total += cell.v;
    }
    setCell(outlet, ci, T, { f: `SUM(${col}${FIRST}:${col}${LAST})`, v: round(total), s: STYLE.BOLD_INT });
  }
  outlet.colWidths.set(1, 12);
  outlet.colWidths.set(2, 14);
  outlet.colWidths.set(3, 38);
  for (let c = 4; c <= LAST_COL; c++) outlet.colWidths.set(c, c === colIndex("AX") || c === colIndex("AZ") ? 14 : 10);
  outlet.freeze = "D4";

  // ---- WD DSR ----------------------------------------------------------------------------------
  const wd = newSheet(WD_SHEET);
  const days = daysBetween(input.from, input.to);
  setCell(wd, 1, 1, { v: "WD NAME - ", s: STYLE.TITLE });
  setCell(wd, 3, 1, { v: `Period: ${ddmmyyyy(input.from)} to ${ddmmyyyy(input.to)}`, s: STYLE.TITLE });
  for (const [col, v] of Object.entries(WD_HEADERS)) setCell(wd, colIndex(col), 2, { v, s: STYLE.HEADER });
  setCell(wd, 2, 2, { v: "", s: STYLE.HEADER });

  // Sale per day per outlet-sheet column, straight from the rows above.
  const saleByDay = new Map<string, Map<string, number>>();
  invoices.forEach((inv, i) => {
    const m = saleByDay.get(inv.date) ?? new Map<string, number>();
    for (const [col, v] of rowQty[i]) m.set(col, (m.get(col) ?? 0) + v);
    saleByDay.set(inv.date, m);
  });
  const openingByCol = new Map<string, number>();
  for (const [name, qty] of Object.entries(input.openingStock)) {
    const col = COLUMN_BY_NAME.get(normName(name));
    if (col) openingByCol.set(col, (openingByCol.get(col) ?? 0) + qty);
  }
  const receivedByDay = new Map<string, Map<string, number>>();
  for (const rec of input.received) {
    const col = COLUMN_BY_NAME.get(normName(rec.productName));
    if (!col) continue;
    const m = receivedByDay.get(rec.date) ?? new Map<string, number>();
    m.set(col, (m.get(col) ?? 0) + rec.quantity);
    receivedByDay.set(rec.date, m);
  }

  const S = `'${OUTLET_SHEET}'!`;
  let prevClosing: Map<string, number> = new Map();
  days.forEach((day, di) => {
    const open = 3 + di * 4;
    const [sale, prim, close] = [open + 1, open + 2, open + 3];
    const labels = ["OPENING", "SALE", "PRIMARY ", "CLOSING"];
    labels.forEach((l, k) => {
      setCell(wd, 3, open + k, { v: l, s: STYLE.BOLD_TEXT });
      setCell(wd, 2, open + k, { s: STYLE.TEXT });
    });
    setCell(
      wd,
      1,
      open,
      di === 0
        ? { v: excelSerial(day), s: STYLE.BOLD_DATE }
        : { f: `A${open - 4}+1`, v: excelSerial(day), s: STYLE.BOLD_DATE },
    );
    for (let k = 1; k < 4; k++) setCell(wd, 1, open + k, { s: STYLE.BOLD_DATE });
    wd.merges.push(`A${open}:B${open + 3}`);

    const openVals = new Map<string, number>();
    const closeVals = new Map<string, number>();
    const rowTotals = { open: [0, 0], sale: [0, 0], prim: [0, 0], close: [0, 0] }; // [GPI, IPM]
    for (const col of WD_SKU_COLS) {
      const oc = outletColumnForWd(col);
      const ci = colIndex(col);
      const isGpi = ci <= colIndex("T");
      const ti = isGpi ? 0 : 1;
      const o = di === 0 ? (openingByCol.get(oc) ?? 0) : (prevClosing.get(oc) ?? 0);
      const s = saleByDay.get(day)?.get(oc) ?? 0;
      const p = receivedByDay.get(day)?.get(oc) ?? 0;
      const c = o - s + p;
      openVals.set(oc, o);
      closeVals.set(oc, c);
      rowTotals.open[ti] += o;
      rowTotals.sale[ti] += s;
      rowTotals.prim[ti] += p;
      rowTotals.close[ti] += c;

      setCell(wd, ci, open, di === 0 ? { v: o, s: STYLE.INT } : { f: `${col}${open - 1}`, v: o, s: STYLE.INT });
      setCell(wd, ci, sale, {
        f: `SUMIFS(${S}${oc}$${FIRST}:${oc}$${LAST},${S}$A$${FIRST}:$A$${LAST},$A$${open})`,
        v: s,
        s: STYLE.INT,
      });
      setCell(wd, ci, prim, { v: p, s: STYLE.INT });
      setCell(wd, ci, close, { f: `${col}${open}-${col}${sale}+${col}${prim}`, v: c, s: STYLE.INT });
    }
    [open, sale, prim, close].forEach((r, k) => {
      const t = [rowTotals.open, rowTotals.sale, rowTotals.prim, rowTotals.close][k];
      setCell(wd, colIndex("U"), r, { f: `SUM(D${r}:T${r})`, v: t[0], s: STYLE.BOLD_INT });
      setCell(wd, colIndex("AS"), r, { f: `SUM(V${r}:AR${r})`, v: t[1], s: STYLE.BOLD_INT });
    });
    prevClosing = closeVals;
    void openVals;
  });
  wd.colWidths.set(1, 12);
  wd.colWidths.set(2, 4);
  wd.colWidths.set(3, 14);
  for (let c = 4; c <= colIndex("AS"); c++) wd.colWidths.set(c, 11);
  wd.freeze = "D3";

  return {
    bytes: buildXlsx([wd, outlet]),
    invoiceCount: invoices.length,
    unmappedProducts: [...unmapped].sort(),
  };
}

export type { Sheet };
