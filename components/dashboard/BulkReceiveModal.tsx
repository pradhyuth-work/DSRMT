"use client";

import { useRef, useState } from "react";
import { Download, Loader2, Plus, Trash2, Upload } from "lucide-react";
import type { BulkReceiveRow, BulkReceiveResultRow } from "@/lib/types";
import { ApiRequestError, api } from "./api-client";
import { Alert } from "./ui";

interface GridRow {
  key: number;
  productCode: string;
  name: string;
  unitPrice: string;
  quantity: string;
}

let nextKey = 1;
const emptyRow = (): GridRow => ({ key: nextKey++, productCode: "", name: "", unitPrice: "", quantity: "" });

const TEMPLATE = "productCode,name,unitPrice,quantity\n3,,,50\n,New Product Name,199.00,25\n";

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
  const col = (name: string) => header.indexOf(name);
  const iCode = col("productcode");
  const iName = col("name");
  const iPrice = col("unitprice");
  const iQty = col("quantity");
  const dataRows = iCode >= 0 || iName >= 0 || iPrice >= 0 || iQty >= 0 ? parsed.slice(1) : parsed;
  return dataRows.map((r) => ({
    key: nextKey++,
    productCode: (iCode >= 0 ? r[iCode] : r[0])?.trim() ?? "",
    name: (iName >= 0 ? r[iName] : r[1])?.trim() ?? "",
    unitPrice: (iPrice >= 0 ? r[iPrice] : r[2])?.trim() ?? "",
    quantity: (iQty >= 0 ? r[iQty] : r[3])?.trim() ?? "",
  }));
}

export default function BulkReceiveModal({ onDone }: { onDone: (message: string) => Promise<void> }) {
  const [rows, setRows] = useState<GridRow[]>([emptyRow()]);
  const [supplierRef, setSupplierRef] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(new Map());
  const [summary, setSummary] = useState<BulkReceiveResultRow[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
    a.download = "stock-receive-template.csv";
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
      const payloadRows: BulkReceiveRow[] = rows.map((r) => ({
        productCode: r.productCode.trim() ? Number.parseInt(r.productCode, 10) : undefined,
        name: r.name.trim() || undefined,
        unitPrice: r.unitPrice.trim() ? Number.parseFloat(r.unitPrice) : undefined,
        quantity: Number.parseInt(r.quantity, 10),
      }));
      const { results } = await api.bulkReceive({ rows: payloadRows, supplierRef: supplierRef.trim() || undefined });
      setSummary(results);
      await onDone(
        `${results.filter((r) => r.action === "RESTOCK").length} restocked, ${results.filter((r) => r.action === "CREATE").length} created`,
      );
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

  const validRowCount = rows.filter((r) => r.quantity.trim() && Number.parseInt(r.quantity, 10) > 0).length;

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
        <label className="label" htmlFor="paste-rows">Or paste rows (CSV, or straight from Excel/Sheets)</label>
        <textarea
          id="paste-rows"
          className="input h-20 font-mono text-xs"
          placeholder={"productCode,name,unitPrice,quantity\n3,,,50"}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          onBlur={() => pasteText.trim() && loadRows(pasteText)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Give a <b>productCode</b> that already exists to add <b>quantity</b> to that product (leave name/price blank).
        Leave productCode blank, or use a new one, to create a product — then name and unitPrice are required.
      </p>

      <div>
        <label className="label" htmlFor="supplier-ref">Supplier / bill reference</label>
        <input
          id="supplier-ref"
          className="input"
          value={supplierRef}
          onChange={(e) => setSupplierRef(e.target.value)}
          placeholder="Optional — recorded against every row in this batch"
          maxLength={120}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-secondary">
            <tr>
              <th className="th">Code</th>
              <th className="th">Name (new only)</th>
              <th className="th">Price (new only)</th>
              <th className="th">Qty</th>
              <th className="th w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={r.key} className={rowErrors.has(i + 1) ? "bg-danger" : ""}>
                <td className="p-1">
                  <input className="input py-1" value={r.productCode} onChange={(e) => update(r.key, { productCode: e.target.value })} placeholder="#" />
                </td>
                <td className="p-1">
                  <input className="input py-1" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} />
                </td>
                <td className="p-1">
                  <input className="input py-1" value={r.unitPrice} onChange={(e) => update(r.key, { unitPrice: e.target.value })} />
                </td>
                <td className="p-1">
                  <input className="input py-1" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
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
                  <td colSpan={5} className="px-2 pb-1 text-xs text-danger-foreground">{rowErrors.get(i + 1)}</td>
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
              Row {r.row}: {r.action === "RESTOCK" ? "restocked" : "created"} #{r.productCode} {r.productName} — now {r.newStockQty} in stock
            </div>
          ))}
        </Alert>
      )}

      <button type="button" className="btn btn-primary w-full" disabled={submitting || validRowCount === 0} onClick={() => void submit()}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Submit {validRowCount} row{validRowCount === 1 ? "" : "s"}
      </button>
    </div>
  );
}
