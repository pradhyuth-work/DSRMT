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
  saved: number;
}

function bump(map: Map<string, AggRow>, id: string, name: string, billedDelta: number, savedDelta: number) {
  const row = map.get(id) ?? { name, billed: 0, saved: 0 };
  row.billed = round2(row.billed + billedDelta);
  row.saved = round2(row.saved + savedDelta);
  map.set(id, row);
}

function toBreakdownRows(map: Map<string, AggRow>): SchemeSavingsBreakdownRow[] {
  return [...map.entries()]
    .map(([id, r]) => ({
      id,
      name: r.name,
      billed: r.billed,
      atScheme: round2(r.billed - r.saved),
      saved: r.saved,
      pctSaved: r.billed > 0 ? round2((r.saved / r.billed) * 100) : 0,
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
  }[];
}

const COUNTED_STATUSES: readonly FulfilmentStatus[] = ["BILLED", "DISPATCHED"];

/**
 * Pure calculation, modelled on buildSalesReport's shape. For each bill, compares what was
 * actually entered (Invoice.totalAmount — the bill book figure, which can be hand-overridden
 * independently of the line items) against what the bill would total at every line's regular,
 * non-scheme price (`listUnitPrice` summed across lines) — "what it would be if not edited"
 * down to scheme pricing. The gap is that bill's saving, whether it came from individual
 * lines being toggled to scheme pricing, a bill-level rounding/negotiated adjustment at
 * billing, or both; there's no need to separate those out.
 *
 * A bill whose entered total exactly matches its full-price total (nothing was ever discounted
 * or hand-adjusted) contributes 0 and is dropped from the bills list/breakdowns entirely — it
 * has nothing to show. The within-bill saving is then prorated across lines by each line's
 * share of the bill's full-price total, so byOutlet/byProduct/byAgent/byMonth sum back to the
 * same headline `saved` the bills list does, line items with no scheme discount don't appear
 * to have one just because another line on the same bill was discounted, and lines also carry
 * `listPriceEstimated` so the UI can flag the historical-estimate caveat.
 */
export function computeSchemeSavings(invoices: SchemeSavingsInvoiceInput[], filters: { productId?: string } = {}): SchemeSavingsResponse {
  let billed = 0;
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
    const invSaved = round2(fullPriceTotal - inv.totalAmount);
    if (invSaved === 0) continue;

    // Share of the bill's saving each line carries, proportional to its share of the
    // full-price total — so the sum of line.saved across a bill matches invSaved exactly
    // (modulo the last line absorbing rounding) rather than drifting from per-line round2.
    const ratio = fullPriceTotal > 0 ? invSaved / fullPriceTotal : 0;
    let allocated = 0;
    const lines: SchemeSavingsBillLine[] = items.map((item, idx) => {
      const lineFullPrice = round2(item.listUnitPrice * item.quantity);
      const lineSaved = idx === items.length - 1 ? round2(invSaved - allocated) : round2(lineFullPrice * ratio);
      allocated = round2(allocated + lineSaved);
      if (item.listPriceEstimated) estimatedLines++;
      bump(byProduct, item.productId, item.productName, lineFullPrice, lineSaved);
      return {
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        listUnitPrice: item.listUnitPrice,
        listPriceEstimated: item.listPriceEstimated,
        saved: lineSaved,
      };
    });

    billed = round2(billed + fullPriceTotal);
    saved = round2(saved + invSaved);
    bills.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      outletName: inv.outletName,
      agentName: inv.staffName,
      billedAt: inv.billedAt.toISOString(),
      billedAmount: fullPriceTotal,
      atScheme: round2(fullPriceTotal - invSaved),
      saved: invSaved,
      items: lines,
    });

    bump(byOutlet, inv.outletId, inv.outletName, fullPriceTotal, invSaved);
    bump(byAgent, inv.staffId, inv.staffName, fullPriceTotal, invSaved);
    const { key, label } = istMonth(inv.billedAt);
    bump(byMonth, key, label, fullPriceTotal, invSaved);
  }

  bills.sort((a, b) => b.billedAt.localeCompare(a.billedAt));
  const byMonthRows = toBreakdownRows(byMonth).sort((a, b) => a.id.localeCompare(b.id));

  return {
    billed,
    atScheme: round2(billed - saved),
    saved,
    pctSaved: billed > 0 ? round2((saved / billed) * 100) : 0,
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
    })),
  }));

  return computeSchemeSavings(input, { productId: filters.productId });
}
