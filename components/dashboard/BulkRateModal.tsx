"use client";

import { useRef, useState } from "react";
import { Download, Loader2, Plus, Trash2, Upload } from "lucide-react";
import type { BulkRateRow, BulkRateResultRow, ProductDTO } from "@/lib/types";
import { ApiRequestError, api } from "./api-client";
import { Alert } from "./ui";
import { Combobox } from "./Combobox";

interface GridRow {
  key: number;
  name: string;
  unitPrice: string;
}

let nextKey = 1;
const emptyRow = (): GridRow => ({ key: nextKey++, name: "", unitPrice: "" });

const TEMPLATE = "name,unitPrice\nProduct Name,199.00\n";

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
  const iName = header.indexOf("name");
  const iPrice = header.indexOf("unitprice");
  const dataRows = iName >= 0 || iPrice >= 0 ? parsed.slice(1) : parsed;
  return dataRows.map((r) => ({
    key: nextKey++,
    name: (iName >= 0 ? r[iName] : r[0])?.trim() ?? "",
    unitPrice: (iPrice >= 0 ? r[iPrice] : r[1])?.trim() ?? "",
  }));
}

/** Bulk price update — every product must already exist (this never creates one); pick it
 * by name in the grid, or upload/paste a name,unitPrice CSV. */
export default function BulkRateModal({ products, onDone }: { products: ProductDTO[]; onDone: (message: string) => Promise<void> }) {
  const [rows, setRows] = useState<GridRow[]>([emptyRow()]);
  const [pasteText, setPasteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(new Map());
  const [summary, setSummary] = useState<BulkRateResultRow[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
    const blob = new Blob([TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk-rate-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const update = (key: number, patch: Partial<GridRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit() {
    setSubmitting(true);
    setError(null);
    setRowErrors(new Map());
    setSummary(null);
    try {
      const payloadRows: BulkRateRow[] = rows
        .filter((r) => r.name.trim() && r.unitPrice.trim())
        .map((r) => ({ name: r.name.trim(), unitPrice: Number.parseFloat(r.unitPrice) }));
      const { results } = await api.bulkUpdateRates({ rows: payloadRows });
      setSummary(results);
      await onDone(`${results.length} product rate${results.length === 1 ? "" : "s"} updated`);
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

  const validRowCount = rows.filter((r) => r.name.trim() && Number.parseFloat(r.unitPrice) > 0).length;

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
        <label className="label" htmlFor="paste-rate-rows">Or paste rows (CSV, or straight from Excel/Sheets)</label>
        <textarea
          id="paste-rate-rows"
          className="input h-20 font-mono text-xs"
          placeholder={"name,unitPrice\nProduct Name,199.00"}
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
              <th className="th">New unit price</th>
              <th className="th w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
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
                <td className="p-1">
                  <input
                    className="input py-1"
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={r.unitPrice}
                    onChange={(e) => update(r.key, { unitPrice: e.target.value })}
                    placeholder="0.00"
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
                  <td colSpan={3} className="px-2 pb-1 text-xs text-danger-foreground">{rowErrors.get(i + 1)}</td>
                )}
              </tr>
            ))}
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
              Row {r.row}: {r.productName} → {r.unitPrice}
            </div>
          ))}
        </Alert>
      )}

      <button type="button" className="btn btn-primary w-full" disabled={submitting || validRowCount === 0} onClick={() => void submit()}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Update {validRowCount} rate{validRowCount === 1 ? "" : "s"}
      </button>
    </div>
  );
}
