"use client";

import { useRef, useState } from "react";
import { Download, Loader2, Plus, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import type { BulkAdjustRow, BulkAdjustResultRow, ProductDTO } from "@/lib/types";
import { ApiRequestError, api } from "./api-client";
import { Alert } from "./ui";
import { Combobox } from "./Combobox";

interface GridRow {
  key: number;
  productCode: string;
  change: string;
  reason: string;
}

let nextKey = 1;
const emptyRow = (): GridRow => ({ key: nextKey++, productCode: "", change: "", reason: "" });

const TEMPLATE = "productCode,change,reason\n3,-5,Damaged in transit\n";

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
  const iCode = header.indexOf("productcode");
  const iChange = header.indexOf("change");
  const iReason = header.indexOf("reason");
  const dataRows = iCode >= 0 || iChange >= 0 || iReason >= 0 ? parsed.slice(1) : parsed;
  return dataRows.map((r) => ({
    key: nextKey++,
    productCode: (iCode >= 0 ? r[iCode] : r[0])?.trim() ?? "",
    change: (iChange >= 0 ? r[iChange] : r[1])?.trim() ?? "",
    reason: (iReason >= 0 ? r[iReason] : r[2])?.trim() ?? "",
  }));
}

/** Bulk stock correction — every product must already exist (this never creates one); pick
 * it by name in the grid, or upload/paste a productCode,change,reason CSV. change is
 * signed: positive adds stock, negative removes it — same convention as the single-item
 * "Adjust stock" action, and every row needs its own reason for the same audit-trail reason. */
export default function BulkAdjustModal({ products, onDone }: { products: ProductDTO[]; onDone: (message: string) => Promise<void> }) {
  const [rows, setRows] = useState<GridRow[]>([emptyRow()]);
  const [pasteText, setPasteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(new Map());
  const [summary, setSummary] = useState<BulkAdjustResultRow[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const productOptions = products.map((p) => ({ value: String(p.productCode), label: p.name, description: `#${p.productCode}` }));

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
    a.download = "bulk-adjust-template.csv";
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
      const payloadRows: BulkAdjustRow[] = rows
        .filter((r) => r.productCode.trim() && r.change.trim() && r.reason.trim())
        .map((r) => ({ productCode: Number.parseInt(r.productCode, 10), change: Number.parseInt(r.change, 10), reason: r.reason.trim() }));
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

  const validRowCount = rows.filter(
    (r) => r.productCode.trim() && Number.isInteger(Number.parseInt(r.change, 10)) && Number.parseInt(r.change, 10) !== 0 && r.reason.trim().length >= 3,
  ).length;

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
          placeholder={"productCode,change,reason\n3,-5,Damaged in transit"}
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
              <th className="th">Change</th>
              <th className="th">Reason</th>
              <th className="th w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={r.key} className={rowErrors.has(i + 1) ? "bg-danger" : ""}>
                <td className="p-1 min-w-48">
                  <Combobox
                    value={r.productCode}
                    onChange={(v) => update(r.key, { productCode: v })}
                    options={productOptions}
                    placeholder="Select product…"
                    ariaLabel={`Product for row ${i + 1}`}
                  />
                </td>
                <td className="p-1 w-28">
                  <input
                    className="input py-1"
                    type="number"
                    step={1}
                    value={r.change}
                    onChange={(e) => update(r.key, { change: e.target.value })}
                    placeholder="-5 or +10"
                  />
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
                  <td colSpan={4} className="px-2 pb-1 text-xs text-danger-foreground">{rowErrors.get(i + 1)}</td>
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
              Row {r.row}: #{r.productCode} {r.productName} {r.change > 0 ? "+" : ""}
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
