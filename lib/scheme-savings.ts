import { prisma } from "./prisma";
import { round2 } from "./money";
import type { FulfilmentStatus, SchemeSavingsBillLine, SchemeSavingsBillRow, SchemeSavingsBreakdownRow, SchemeSavingsResponse } from "./types";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Calendar month a UTC instant falls on in India time — "2026-01" to group/sort by, "Jan
 * 2026" to show. Shifting the instant by the IST offset and then reading it back with UTC
 * getters (and formatting with timeZone: "UTC") sidesteps the host machine's own timezone. */
function istMonth(d: Date): { key: string; label: string } {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const key = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
  const label = ist.toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  return { key, label };
}

interface AggRow {
  name: string;
  billed: number;
  atScheme: number;
  saved: number;
}

function bump(map: Map<string, AggRow>, id: string, name: string, billedDelta: number, atSchemeDelta: number, savedDelta: number) {
  const row = map.get(id) ?? { name, billed: 0, atScheme: 0, saved: 0 };
  row.billed = round2(row.billed + billedDelta);
  row.atScheme = round2(row.atScheme + atSchemeDelta);
  row.saved = round2(row.saved + savedDelta);
  map.set(id, row);
}

function toBreakdownRows(map: Map<string, AggRow>): SchemeSavingsBreakdownRow[] {
  return [...map.entries()]
    .map(([id, r]) => ({
      id,
      name: r.name,
      billed: r.billed,
      atScheme: r.atScheme,
      saved: r.saved,
      pctSaved: r.atScheme > 0 ? round2((r.saved / r.atScheme) * 100) : 0,
    }))
    .sort((a, b) => b.saved - a.saved);
}

/** The already-billed/dispatched-or-not shape `computeSchemeSavings` works from — plain data
 * so it can be unit-tested with fixtures, without a database. */
export interface SchemeSavingsInvoiceInput {
  id: string;
  invoiceNumber: string | null;
  billedAt: Date | null;
  fulfilmentStatus: FulfilmentStatus;
  outletId: string;
  outletName: string;
  staffId: string;
  staffName: string;
  /** The bill value actually entered at billing — may have been hand-overridden independently
   * of the line items (see POST .../bill). This is what Scheme Savings compares the bill's
   * full-price total against. */
  totalAmount: number;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    /** The product's regular (non-scheme) unit price at billing — "what it would be if not
     * edited" down to scheme pricing for this line. Always present once billed. */
    listUnitPrice: number;
    listPriceEstimated: boolean;
    /** The product's scheme (promotional) unit price at billing — "what it would be if given
     * at scheme" for this line. Null when the product had no active scheme price at billing
     * time; computeSchemeSavings falls back to listUnitPrice for such lines (no discount
     * sanctioned, so nothing to be "missed" there). */
    schemeUnitPrice: number | null;
    schemePriceEstimated: boolean;
  }[];
}

const COUNTED_STATUSES: readonly FulfilmentStatus[] = ["BILLED", "DISPATCHED"];

/**
 * Pure calculation, modelled on buildSalesReport's shape. For each bill, compares what was
 * actually entered (Invoice.totalAmount — the bill book figure, which can be hand-overridden
 * independently of the line items) against what the bill would total if every line were given
 * at the product's scheme price (`schemeUnitPrice` summed across lines, falling back to that
 * line's `listUnitPrice` where no scheme was available — nothing sanctioned to miss there).
 * The gap is that bill's saving: how much more than the ideal scheme total was actually billed
 * (or, if negative, how much of an ad hoc discount beyond what any scheme allows was given).
 *
 * `listUnitPrice` (full, non-scheme price) is also summed per bill and reported as `billed` —
 * informational context for the "what this would be at full price" figure — but it's the
 * scheme total, not the full-price total, that `saved` is measured against.
 *
 * A bill whose entered total exactly matches its scheme total (the scheme, where available,
 * was applied exactly; where not available, billed at exactly full price) contributes 0 and is
 * dropped from the bills list/breakdowns entirely — it has nothing to show. The within-bill
 * saving is then prorated across lines by each line's share of the bill's scheme total, so
 * byOutlet/byProduct/byAgent/byMonth sum back to the same headline `saved` the bills list does,
 * and lines also carry `listPriceEstimated`/`schemePriceEstimated` so the UI can flag the
 * historical-estimate caveat.
 */
export function computeSchemeSavings(invoices: SchemeSavingsInvoiceInput[], filters: { productId?: string } = {}): SchemeSavingsResponse {
  let billed = 0;
  let atScheme = 0;
  let saved = 0;
  let estimatedLines = 0;

  const byOutlet = new Map<string, AggRow>();
  const byProduct = new Map<string, AggRow>();
  const byAgent = new Map<string, AggRow>();
  const byMonth = new Map<string, AggRow>();
  const bills: SchemeSavingsBillRow[] = [];

  for (const inv of invoices) {
    if (!COUNTED_STATUSES.includes(inv.fulfilmentStatus)) continue;
    if (!inv.billedAt) continue; // shouldn't happen for BILLED/DISPATCHED, but keeps this total

    const items = filters.productId ? inv.items.filter((i) => i.productId === filters.productId) : inv.items;
    if (items.length === 0) continue;

    const fullPriceTotal = round2(items.reduce((sum, i) => sum + i.listUnitPrice * i.quantity, 0));
    const schemeTotal = round2(items.reduce((sum, i) => sum + (i.schemeUnitPrice ?? i.listUnitPrice) * i.quantity, 0));
    const invSaved = round2(inv.totalAmount - schemeTotal);
    if (invSaved === 0) continue;

    // The bill's saving is attributed only to lines that actually had a scheme price to
    // miss — a line with no scheme at all has nothing to "miss" and shouldn't pick up a
    // slice of the gap just because it's a big line by full-price weight. Only when *no*
    // line in the bill has a scheme (a pure bill-level/manual adjustment, unrelated to any
    // scheme) does the whole bill share it, by scheme-equivalent (= full-price) weight.
    const eligible = items.filter((i) => i.schemeUnitPrice != null);
    const basis = eligible.length > 0 ? eligible : items;
    const basisTotal = round2(basis.reduce((sum, i) => sum + (i.schemeUnitPrice ?? i.listUnitPrice) * i.quantity, 0));
    const ratio = basisTotal > 0 ? invSaved / basisTotal : 0;

    // Share of the bill's saving each basis line carries, proportional to its share of the
    // basis total — so the sum of line.saved across a bill matches invSaved exactly (modulo
    // the last basis line absorbing rounding) rather than drifting from per-line round2. Keyed
    // by object identity, not productId — an invoice can carry two separate lines for the
    // same product (e.g. one scheme, one not), and productId alone would collide them.
    const savedByItem = new Map<(typeof items)[number], number>();
    let allocated = 0;
    basis.forEach((item, idx) => {
      const lineBasisAmount = round2((item.schemeUnitPrice ?? item.listUnitPrice) * item.quantity);
      const lineSaved = idx === basis.length - 1 ? round2(invSaved - allocated) : round2(lineBasisAmount * ratio);
      allocated = round2(allocated + lineSaved);
      savedByItem.set(item, lineSaved);
    });

    const lines: SchemeSavingsBillLine[] = items.map((item) => {
      const lineSaved = savedByItem.get(item) ?? 0;
      const lineSchemeTotal = round2((item.schemeUnitPrice ?? item.listUnitPrice) * item.quantity);
      if (item.listPriceEstimated || item.schemePriceEstimated) estimatedLines++;
      bump(byProduct, item.productId, item.productName, round2(item.listUnitPrice * item.quantity), lineSchemeTotal, lineSaved);
      return {
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        listUnitPrice: item.listUnitPrice,
        listPriceEstimated: item.listPriceEstimated,
        schemeUnitPrice: item.schemeUnitPrice,
        schemePriceEstimated: item.schemePriceEstimated,
        saved: lineSaved,
      };
    });

    billed = round2(billed + fullPriceTotal);
    atScheme = round2(atScheme + schemeTotal);
    saved = round2(saved + invSaved);
    bills.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      outletName: inv.outletName,
      agentName: inv.staffName,
      billedAt: inv.billedAt.toISOString(),
      billedAmount: fullPriceTotal,
      atScheme: schemeTotal,
      saved: invSaved,
      items: lines,
    });

    bump(byOutlet, inv.outletId, inv.outletName, fullPriceTotal, schemeTotal, invSaved);
    bump(byAgent, inv.staffId, inv.staffName, fullPriceTotal, schemeTotal, invSaved);
    const { key, label } = istMonth(inv.billedAt);
    bump(byMonth, key, label, fullPriceTotal, schemeTotal, invSaved);
  }

  bills.sort((a, b) => b.billedAt.localeCompare(a.billedAt));
  const byMonthRows = toBreakdownRows(byMonth).sort((a, b) => a.id.localeCompare(b.id));

  return {
    billed,
    atScheme,
    saved,
    pctSaved: atScheme > 0 ? round2((saved / atScheme) * 100) : 0,
    billCount: bills.length,
    estimatedLines,
    byOutlet: toBreakdownRows(byOutlet),
    byProduct: toBreakdownRows(byProduct),
    byAgent: toBreakdownRows(byAgent),
    byMonth: byMonthRows,
    bills,
  };
}

export interface SchemeSavingsFilters {
  from?: Date;
  to?: Date;
  outletId?: string;
  productId?: string;
  staffId?: string;
}

/** Fetches what's needed and hands it to computeSchemeSavings. The DB-level status/product
 * filters here are an optimisation (less fetched); computeSchemeSavings re-checks both
 * itself regardless. */
export async function buildSchemeSavings(filters: SchemeSavingsFilters = {}): Promise<SchemeSavingsResponse> {
  const dateFilter = filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined;

  const invoices = await prisma.invoice.findMany({
    where: {
      fulfilmentStatus: { in: ["BILLED", "DISPATCHED"] },
      billedAt: dateFilter,
      outletId: filters.outletId,
      staffId: filters.staffId,
      items: filters.productId ? { some: { productId: filters.productId } } : undefined,
    },
    orderBy: { billedAt: "asc" },
    select: {
      id: true,
      invoiceNumber: true,
      billedAt: true,
      fulfilmentStatus: true,
      outletId: true,
      outlet: { select: { name: true } },
      staffId: true,
      staff: { select: { name: true } },
      totalAmount: true,
      items: {
        select: {
          productId: true,
          quantity: true,
          unitPrice: true,
          listUnitPrice: true,
          listPriceEstimated: true,
          schemeUnitPrice: true,
          schemePriceEstimated: true,
          product: { select: { name: true } },
        },
      },
    },
  });

  const input = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    billedAt: inv.billedAt,
    fulfilmentStatus: inv.fulfilmentStatus,
    outletId: inv.outletId,
    outletName: inv.outlet.name,
    staffId: inv.staffId,
    staffName: inv.staff.name,
    totalAmount: inv.totalAmount,
    items: inv.items.map((i) => ({
      productId: i.productId,
      productName: i.product.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      // listUnitPrice is only null for a PENDING-at-the-time-of-this-query line that hasn't
      // been billed yet; COUNTED_STATUSES already restricts this query to BILLED/DISPATCHED,
      // so every row here has gone through the bill route's snapshot and this is never null
      // in practice. Fall back to unitPrice defensively rather than letting a bad line throw.
      listUnitPrice: i.listUnitPrice ?? i.unitPrice,
      listPriceEstimated: i.listPriceEstimated,
      schemeUnitPrice: i.schemeUnitPrice,
      schemePriceEstimated: i.schemePriceEstimated,
    })),
  }));

  return computeSchemeSavings(input, { productId: filters.productId });
}
