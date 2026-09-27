"use client";

import { useRef, useState } from "react";
import { Download, Loader2, Plus, Store, Trash2, Upload } from "lucide-react";
import type { BulkOutletRow, BulkOutletResultRow, RouteDTO } from "@/lib/types";
import { ApiRequestError, api } from "./api-client";
import { Alert } from "./ui";
import { Combobox } from "./Combobox";

interface GridRow {
  key: number;
  name: string;
  phone: string;
  address: string;
  gstNumber: string;
  routeName: string;
}

let nextKey = 1;
const emptyRow = (): GridRow => ({ key: nextKey++, name: "", phone: "", address: "", gstNumber: "", routeName: "" });

const TEMPLATE = "name,phone,address,gstNumber,routeName\nGreen Leaf Cafe,9876500010,12 MG Road Bengaluru,29ABCDE1234F1Z5,Ravi Kumar's Route\n";

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
  const iName = col("name");
  const iPhone = col("phone");
  const iAddress = col("address");
  const iGst = col("gstnumber");
  const iRoute = col("routename");
  const hasHeader = [iName, iPhone, iAddress, iGst, iRoute].some((i) => i >= 0);
  const dataRows = hasHeader ? parsed.slice(1) : parsed;
  return dataRows.map((r) => ({
    key: nextKey++,
    name: (iName >= 0 ? r[iName] : r[0])?.trim() ?? "",
    phone: (iPhone >= 0 ? r[iPhone] : r[1])?.trim() ?? "",
    address: (iAddress >= 0 ? r[iAddress] : r[2])?.trim() ?? "",
    gstNumber: (iGst >= 0 ? r[iGst] : r[3])?.trim() ?? "",
    routeName: (iRoute >= 0 ? r[iRoute] : r[4])?.trim() ?? "",
  }));
}

/**
 * Adds one or many outlets at once — CSV upload, paste, or the in-app grid all feed the
 * same row list and the same endpoint, so a single outlet is just a one-row batch. Each
 * row's route is matched by name (searchable picker below); leave it blank for no route.
 */
export default function BulkOutletModal({ routes, onDone }: { routes: RouteDTO[]; onDone: (message: string) => Promise<void> }) {
  const [rows, setRows] = useState<GridRow[]>([emptyRow()]);
  const [pasteText, setPasteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(new Map());
  const [summary, setSummary] = useState<BulkOutletResultRow[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const routeOptions = [{ value: "", label: "— No route —" }, ...routes.map((r) => ({ value: r.name, label: r.name, description: r.agentName ?? "Unassigned" }))];

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
    a.download = "outlets-template.csv";
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
      const payloadRows: BulkOutletRow[] = rows
        .filter((r) => r.name.trim())
        .map((r) => ({
          name: r.name.trim(),
          phone: r.phone.trim() || undefined,
          address: r.address.trim() || undefined,
          gstNumber: r.gstNumber.trim() || undefined,
          routeName: r.routeName.trim() || undefined,
        }));
      const { results } = await api.bulkCreateOutlets({ rows: payloadRows });
      setSummary(results);
      await onDone(`${results.length} outlet${results.length === 1 ? "" : "s"} added`);
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

  const validRowCount = rows.filter((r) => r.name.trim()).length;

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
        <label className="label" htmlFor="paste-outlet-rows">Or paste rows (CSV, or straight from Excel/Sheets)</label>
        <textarea
          id="paste-outlet-rows"
          className="input h-20 font-mono text-xs"
          placeholder={"name,phone,address,gstNumber,routeName"}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          onBlur={() => pasteText.trim() && loadRows(pasteText)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        <b>routeName</b> must match an existing route exactly (case-insensitive) — leave it blank for no route. Only
        <b> name</b> is required; phone, address and GST number are all optional.
      </p>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-secondary">
            <tr>
              <th className="th min-w-[180px]">Name</th>
              <th className="th min-w-[130px]">Phone</th>
              <th className="th min-w-[240px]">Address</th>
              <th className="th min-w-[150px]">GST number</th>
              <th className="th min-w-[170px]">Route</th>
              <th className="th w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={r.key} className={rowErrors.has(i + 1) ? "bg-danger" : ""}>
                <td className="p-1 min-w-[180px]"><input className="input py-1" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} placeholder="Required" /></td>
                <td className="p-1 min-w-[130px]"><input className="input py-1" value={r.phone} onChange={(e) => update(r.key, { phone: e.target.value })} /></td>
                <td className="p-1 min-w-[240px]"><input className="input py-1" value={r.address} onChange={(e) => update(r.key, { address: e.target.value })} /></td>
                <td className="p-1 min-w-[150px]"><input className="input py-1" value={r.gstNumber} onChange={(e) => update(r.key, { gstNumber: e.target.value.toUpperCase() })} maxLength={15} placeholder="Optional" /></td>
                <td className="p-1 min-w-[170px]">
                  <Combobox
                    value={r.routeName}
                    onChange={(v) => update(r.key, { routeName: v })}
                    options={routeOptions}
                    placeholder="No route"
                    ariaLabel={`Route for row ${i + 1}`}
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
              Row {r.row}: added {r.outletName}{r.routeName ? ` — ${r.routeName}` : ""}
            </div>
          ))}
        </Alert>
      )}

      <button type="button" className="btn btn-primary w-full" disabled={submitting || validRowCount === 0} onClick={() => void submit()}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
        {validRowCount === 1 ? "Add outlet" : `Add ${validRowCount} outlets`}
      </button>
    </div>
  );
}
