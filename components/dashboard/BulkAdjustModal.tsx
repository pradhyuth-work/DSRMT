"use client";

import { useRef, useState } from "react";
import { Download, Loader2, Plus, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import type { BulkAdjustRow, BulkAdjustResultRow, ProductDTO } from "@/lib/types";
import { ApiRequestError, api } from "./api-client";
import { Alert } from "./ui";
import { Combobox } from "./Combobox";

interface GridRow {
  key: number;
  name: string;
  physicalStock: string;
  reason: string;
}

const DEFAULT_REASON = "Physical stock count";

let nextKey = 1;
const emptyRow = (): GridRow => ({ key: nextKey++, name: "", physicalStock: "", reason: DEFAULT_REASON });

/** Quotes a CSV field only when it needs it — keeps plain numbers and names readable. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Minimal CSV parser: comma-separated, double-quote escaping (a "" inside a quoted field is a literal quote). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function rowsFromCsv(text: string): GridRow[] {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return [];
  const header = parsed[0].map((h) => h.trim().toLowerCase());
  const iName = header.indexOf("product") >= 0 ? header.indexOf("product") : header.indexOf("name");
  const iPhysical = header.indexOf("physicalstock");
  const iReason = header.indexOf("reason");
  const dataRows = iName >= 0 || iPhysical >= 0 || iReason >= 0 ? parsed.slice(1) : parsed;
  return dataRows.map((r) => ({
    key: nextKey++,
    name: (iName >= 0 ? r[iName] : r[0])?.trim() ?? "",
    physicalStock: (iPhysical >= 0 ? r[iPhysical] : r[2])?.trim() ?? "",
    reason: ((iReason >= 0 ? r[iReason] : r[3])?.trim() || DEFAULT_REASON),
  }));
}

/** Bulk stock correction driven by a physical count, not a manually-computed delta — every
 * product must already exist (this never creates one). Download the template to get every
 * product's name and current system stock, fill in what was actually counted, and
 * re-upload; the signed change sent to the API (same convention as the single-item "Adjust
 * stock" action) is computed here against each product's *live* stock, not whatever the
 * template said at download time, so a count taken a while ago still lands correctly. */
export default function BulkAdjustModal({ products, onDone }: { products: ProductDTO[]; onDone: (message: string) => Promise<void> }) {
  const [rows, setRows] = useState<GridRow[]>([emptyRow()]);
  const [pasteText, setPasteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(new Map());
  const [summary, setSummary] = useState<BulkAdjustResultRow[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
  const productOptions = products.map((p) => ({ value: p.name, label: p.name }));

  function loadRows(text: string) {
    const parsed = rowsFromCsv(text);
    if (parsed.length > 0) {
      setRows(parsed);
      setSummary(null);
      setError(null);
      setRowErrors(new Map());
    }
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => loadRows(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const header = ["product", "currentStock", "physicalStock", "reason"];
    const body = products.map((p) => [p.name, p.stockQty ?? 0, "", ""]);
    const csv = [header, ...body].map((r) => r.map(csvField).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk-adjust-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const update = (key: number, patch: Partial<GridRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function toPayloadRow(r: GridRow): BulkAdjustRow | null {
    const product = byName.get(r.name.trim().toLowerCase());
    const physical = Number.parseInt(r.physicalStock, 10);
    if (!product || !Number.isInteger(physical) || physical < 0 || !r.reason.trim()) return null;
    const change = physical - (product.stockQty ?? 0);
    if (change === 0) return null;
    return { name: product.name, change, reason: r.reason.trim() };
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    setRowErrors(new Map());
    setSummary(null);
    try {
      const payloadRows = rows.map(toPayloadRow).filter((r): r is BulkAdjustRow => r !== null);
      const { results } = await api.bulkAdjustStock({ rows: payloadRows });
      setSummary(results);
      await onDone(`${results.length} stock adjustment${results.length === 1 ? "" : "s"} recorded`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      const errors = (err instanceof ApiRequestError ? err.details : undefined) as
        | { errors?: { row: number; error: string }[] }
        | undefined;
      if (errors?.errors) setRowErrors(new Map(errors.errors.map((e) => [e.row, e.error])));
    } finally {
      setSubmitting(false);
    }
  }

  const validRowCount = rows.filter((r) => toPayloadRow(r) !== null).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}>
          <Upload className="h-4 w-4" /> Upload CSV
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={downloadTemplate}>
          <Download className="h-4 w-4" /> Download template
        </button>
      </div>

      <div>
        <label className="label" htmlFor="paste-adjust-rows">Or paste rows (CSV, or straight from Excel/Sheets)</label>
        <textarea
          id="paste-adjust-rows"
          className="input h-20 font-mono text-xs"
          placeholder={"product,physicalStock,reason\nProduct Name,113,Physical stock count"}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          onBlur={() => pasteText.trim() && loadRows(pasteText)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-secondary">
            <tr>
              <th className="th">Product</th>
              <th className="th text-right">Current</th>
              <th className="th">Physical Stock</th>
              <th className="th text-right">Change</th>
              <th className="th">Reason</th>
              <th className="th w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => {
              const product = byName.get(r.name.trim().toLowerCase());
              const physical = Number.parseInt(r.physicalStock, 10);
              const change = product && Number.isInteger(physical) ? physical - (product.stockQty ?? 0) : null;
              return (
              <tr key={r.key} className={rowErrors.has(i + 1) ? "bg-danger" : ""}>
                <td className="p-1 min-w-48">
                  <Combobox
                    value={r.name}
                    onChange={(v) => update(r.key, { name: v })}
                    options={productOptions}
                    placeholder="Select product…"
                    ariaLabel={`Product for row ${i + 1}`}
                  />
                </td>
                <td className="p-1 w-20 text-right tabular-nums text-muted-foreground">{product ? product.stockQty ?? 0 : "—"}</td>
                <td className="p-1 w-28">
                  <input
                    className="input py-1"
                    type="number"
                    step={1}
                    min={0}
                    value={r.physicalStock}
                    onChange={(e) => update(r.key, { physicalStock: e.target.value })}
                    placeholder="Counted qty"
                  />
                </td>
                <td
                  className={`p-1 w-20 text-right tabular-nums font-medium ${
                    change === null || change === 0 ? "text-muted-foreground" : change > 0 ? "text-success-foreground" : "text-warning-foreground"
                  }`}
                >
                  {change === null ? "—" : change > 0 ? `+${change}` : change}
                </td>
                <td className="p-1 min-w-48">
                  <input
                    className="input py-1"
                    value={r.reason}
                    onChange={(e) => update(r.key, { reason: e.target.value })}
                    placeholder="e.g. Stock count correction"
                    maxLength={200}
                  />
                </td>
                <td className="p-1">
                  <button
                    type="button"
                    className="rounded p-1.5 text-muted-foreground hover:bg-danger hover:text-danger-foreground disabled:opacity-30"
                    disabled={rows.length === 1}
                    onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                    aria-label="Remove row"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
                {rowErrors.has(i + 1) && (
                  <td colSpan={6} className="px-2 pb-1 text-xs text-danger-foreground">{rowErrors.get(i + 1)}</td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => setRows((prev) => [...prev, emptyRow()])}>
        <Plus className="h-4 w-4" /> Add row
      </button>

      {error && <Alert kind="error">{error}</Alert>}
      {summary && (
        <Alert kind="success">
          {summary.map((r) => (
            <div key={r.row}>
              Row {r.row}: {r.productName} {r.change > 0 ? "+" : ""}
              {r.change} → now {r.newStockQty}
            </div>
          ))}
        </Alert>
      )}

      <button type="button" className="btn btn-primary w-full" disabled={submitting || validRowCount === 0} onClick={() => void submit()}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
        Submit {validRowCount} adjustment{validRowCount === 1 ? "" : "s"}
      </button>
    </div>
  );
}
