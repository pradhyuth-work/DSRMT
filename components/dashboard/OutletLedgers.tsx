"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, HandCoins, Loader2, Plus, Route as RouteIcon, Search, Store } from "lucide-react";
import type { OutletDTO, OutletLedger, ReportsResponse, RouteDTO, StaffDTO } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, Modal, formatDate } from "./ui";
import { CollectPaymentForm } from "./payment-form";
import RoutesManager from "./RoutesManager";

interface LedgerData {
  reports: ReportsResponse;
  staff: StaffDTO[];
  outlets: OutletDTO[];
  routes: RouteDTO[];
}

const UNASSIGNED = "__unassigned__";

/** A route's label in a picker: its name plus who's currently on it, so picking one is informed. */
function routeLabel(r: RouteDTO): string {
  return `${r.name}${r.agentName ? ` — ${r.agentName}` : " — Unassigned"}`;
}

export default function OutletLedgers({ data, onSaved }: { data: LedgerData; onSaved: () => Promise<void> }) {
  const ledgers = data.reports.outletLedgers;
  const agents = useMemo(() => data.staff.filter((s) => s.role === "agent"), [data.staff]);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<OutletLedger | null>(null);
  const [addingOutlet, setAddingOutlet] = useState(false);
  const [managingRoutes, setManagingRoutes] = useState(false);
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledgers.filter((l) => {
      if (agentFilter === UNASSIGNED && l.agentId) return false;
      if (agentFilter && agentFilter !== UNASSIGNED && l.agentId !== agentFilter) return false;
      if (q && !l.outletName.toLowerCase().includes(q) && !l.phone.includes(q)) return false;
      return true;
    });
  }, [ledgers, search, agentFilter]);

  async function reassignRoute(outletId: string, routeId: string) {
    setReassigning(outletId);
    try {
      await api.updateOutlet(outletId, { routeId: routeId || null });
      setFlash({ kind: "success", text: "Outlet moved to a different route" });
      await onSaved();
    } catch (err) {
      setFlash({ kind: "error", text: err instanceof Error ? err.message : "Failed to move outlet" });
    } finally {
      setReassigning(null);
    }
  }

  return (
    <div className="space-y-4">
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      {/* Always-visible search + filter bar. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input pl-9"
            placeholder="Search outlets by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input sm:w-56" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} aria-label="Filter by field agent">
          <option value="">All field agents</option>
          <option value={UNASSIGNED}>Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button className="btn btn-secondary sm:w-auto" onClick={() => setManagingRoutes(true)}>
          <RouteIcon className="h-4 w-4" /> Manage routes
        </button>
        <button className="btn btn-secondary sm:w-auto" onClick={() => setAddingOutlet(true)}>
          <Plus className="h-4 w-4" /> Add outlet
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-secondary">
              <tr>
                <th className="th w-8" />
                <th className="th">Outlet</th>
                <th className="th">Route</th>
                <th className="th text-right">Total Billed</th>
                <th className="th text-right">Total Paid</th>
                <th className="th text-right">Balance</th>
                <th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((l) => {
                const isOpen = expanded === l.outletId;
                return (
                  <Fragment key={l.outletId}>
                    <tr className="hover:bg-secondary">
                      <td className="td">
                        <button
                          onClick={() => setExpanded(isOpen ? null : l.outletId)}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary"
                          aria-label={isOpen ? "Hide ledger" : "Show ledger"}
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="td">
                        <p className="font-medium">{l.outletName}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.phone} · {l.openInvoices.length} open invoice{l.openInvoices.length === 1 ? "" : "s"}
                        </p>
                      </td>
                      <td className="td">
                        <select
                          className="input py-1.5 text-sm"
                          value={l.routeId ?? ""}
                          disabled={reassigning === l.outletId}
                          onChange={(e) => void reassignRoute(l.outletId, e.target.value)}
                          aria-label={`Route for ${l.outletName}`}
                        >
                          <option value="">— No route —</option>
                          {data.routes.map((r) => (
                            <option key={r.id} value={r.id}>{routeLabel(r)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="td text-right tabular-nums">{formatMoney(l.totalBilled)}</td>
                      <td className="td text-right tabular-nums text-success-foreground">{formatMoney(l.totalPaid)}</td>
                      <td className={`td text-right font-semibold tabular-nums ${l.balance > 0 ? "text-warning-foreground" : "text-muted-foreground"}`}>
                        {formatMoney(l.balance)}
                      </td>
                      <td className="td text-right">
                        <button
                          className="btn btn-primary px-3 py-1.5"
                          disabled={l.balance <= 0}
                          onClick={() => {
                            setFlash(null);
                            setCollecting(l);
                          }}
                        >
                          <HandCoins className="h-4 w-4" />
                          <span className="hidden md:inline">Collect Payment</span>
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} className="bg-secondary px-4 py-3">
                          <LedgerTable ledger={l} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <EmptyState>{ledgers.length === 0 ? "No outlets yet." : "No outlets match your search."}</EmptyState>
        )}
      </div>

      <Modal open={!!collecting} title={`Collect payment — ${collecting?.outletName ?? ""}`} onClose={() => setCollecting(null)}>
        {collecting && (
          <CollectPaymentForm
            key={collecting.outletId}
            target={{ outletId: collecting.outletId, outletName: collecting.outletName, balance: collecting.balance, openInvoices: collecting.openInvoices }}
            staffOptions={data.staff}
            onDone={async (message) => {
              setCollecting(null);
              setFlash({ kind: "success", text: message });
              await onSaved();
            }}
          />
        )}
      </Modal>

      <Modal open={addingOutlet} title="Add outlet" onClose={() => setAddingOutlet(false)}>
        <AddOutletForm
          routes={data.routes}
          onDone={async (message) => {
            setAddingOutlet(false);
            setFlash({ kind: "success", text: message });
            await onSaved();
          }}
        />
      </Modal>

      <Modal open={managingRoutes} title="Manage routes" onClose={() => setManagingRoutes(false)}>
        <RoutesManager
          routes={data.routes}
          agents={agents}
          onSaved={async () => {
            setFlash({ kind: "success", text: "Routes updated" });
            await onSaved();
          }}
        />
      </Modal>
    </div>
  );
}

function LedgerTable({ ledger }: { ledger: OutletLedger }) {
  if (ledger.entries.length === 0) return <EmptyState>No transactions for this outlet yet.</EmptyState>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead>
          <tr>
            <th className="th">Date</th>
            <th className="th">Ref</th>
            <th className="th">Description</th>
            <th className="th text-right">Debit</th>
            <th className="th text-right">Credit</th>
            <th className="th text-right">Running Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ledger.entries.map((e, i) => (
            <tr key={`${e.reference}-${e.type}-${i}`}>
              <td className="td whitespace-nowrap text-muted-foreground">{formatDate(e.date)}</td>
              <td className="td font-mono text-xs">{e.reference}</td>
              <td className="td">{e.description}</td>
              <td className="td text-right tabular-nums">{e.debit ? formatMoney(e.debit) : ""}</td>
              <td className="td text-right tabular-nums text-success-foreground">{e.credit ? formatMoney(e.credit) : ""}</td>
              <td className="td text-right font-medium tabular-nums">{formatMoney(e.runningBalance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddOutletForm({ routes, onDone }: { routes: RouteDTO[]; onDone: (message: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [routeId, setRouteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createOutlet({ name: name.trim(), phone: phone.trim(), routeId: routeId || null });
      await onDone(`Added ${created.name}${created.agentName ? ` (on ${created.routeName}, ${created.agentName}'s route)` : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add outlet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="o-name">Name</label>
        <input id="o-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="o-phone">Phone</label>
        <input id="o-phone" type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
      </div>
      <div>
        <label className="label" htmlFor="o-route">Route</label>
        <select id="o-route" className="input" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
          <option value="">— No route —</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>{routeLabel(r)}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">Only that route's agent will see this outlet when creating an order.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
        Add outlet
      </button>
    </form>
  );
}
