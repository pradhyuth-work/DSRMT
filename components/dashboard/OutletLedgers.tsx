"use client";

import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Eye, EyeOff, HandCoins, Loader2, Plus, Route as RouteIcon, Search, Trash2 } from "lucide-react";
import type { OutletDTO, OutletLedger, ReportsResponse, RouteDTO, StaffDTO } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, Modal, formatDate } from "./ui";
import { CollectPaymentForm } from "./payment-form";
import RoutesManager from "./RoutesManager";
import BulkOutletModal from "./BulkOutletModal";
import { Combobox } from "./Combobox";

interface LedgerData {
  reports: ReportsResponse;
  staff: StaffDTO[];
  outlets: OutletDTO[];
  routes: RouteDTO[];
}

const UNASSIGNED = "__unassigned__";

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
  const [togglingHidden, setTogglingHidden] = useState<string | null>(null);
  const [deletingOutlet, setDeletingOutlet] = useState<OutletLedger | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  async function toggleHidden(l: OutletLedger) {
    setTogglingHidden(l.outletId);
    try {
      await api.hideOutlet(l.outletId, { hidden: !l.hidden });
      setFlash({ kind: "success", text: l.hidden ? `${l.outletName} is visible again` : `${l.outletName} is hidden from order-taking` });
      await onSaved();
    } catch (err) {
      setFlash({ kind: "error", text: err instanceof Error ? err.message : "Failed to update outlet" });
    } finally {
      setTogglingHidden(null);
    }
  }

  async function confirmDelete() {
    if (!deletingOutlet) return;
    setDeleting(true);
    try {
      await api.deleteOutlet(deletingOutlet.outletId);
      setFlash({ kind: "success", text: `${deletingOutlet.outletName} deleted` });
      setDeletingOutlet(null);
      await onSaved();
    } catch (err) {
      setFlash({ kind: "error", text: err instanceof Error ? err.message : "Failed to delete outlet" });
    } finally {
      setDeleting(false);
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
        <Combobox
          className="sm:w-56"
          value={agentFilter}
          onChange={setAgentFilter}
          ariaLabel="Filter by field agent"
          placeholder="All field agents"
          options={[
            { value: "", label: "All field agents" },
            { value: UNASSIGNED, label: "Unassigned" },
            ...agents.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
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
                        <p className="flex items-center gap-1.5 font-medium">
                          {l.outletName}
                          {l.hidden && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Hidden</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {l.phone} · {l.openInvoices.length} open invoice{l.openInvoices.length === 1 ? "" : "s"}
                        </p>
                      </td>
                      <td className="td min-w-40">
                        <Combobox
                          value={l.routeId ?? ""}
                          onChange={(v) => void reassignRoute(l.outletId, v)}
                          disabled={reassigning === l.outletId}
                          ariaLabel={`Route for ${l.outletName}`}
                          placeholder="— No route —"
                          options={[
                            { value: "", label: "— No route —" },
                            ...data.routes.map((r) => ({ value: r.id, label: r.name, description: r.agentName ?? "Unassigned" })),
                          ]}
                        />
                      </td>
                      <td className="td text-right tabular-nums">{formatMoney(l.totalBilled)}</td>
                      <td className="td text-right tabular-nums text-success-foreground">{formatMoney(l.totalPaid)}</td>
                      <td className={`td text-right font-semibold tabular-nums ${l.balance > 0 ? "text-warning-foreground" : "text-muted-foreground"}`}>
                        {formatMoney(l.balance)}
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button
                            className="btn btn-secondary px-2.5"
                            disabled={togglingHidden === l.outletId}
                            onClick={() => void toggleHidden(l)}
                            aria-label={l.hidden ? `Unhide ${l.outletName}` : `Hide ${l.outletName}`}
                            title={l.hidden ? "Show in order-taking again" : "Hide from order-taking"}
                          >
                            {togglingHidden === l.outletId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : l.hidden ? (
                              <Eye className="h-4 w-4" />
                            ) : (
                              <EyeOff className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            className="btn btn-secondary px-2.5 text-danger-foreground"
                            onClick={() => setDeletingOutlet(l)}
                            aria-label={`Delete ${l.outletName}`}
                            title="Delete outlet"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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
                        </div>
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

      <Modal open={addingOutlet} title="Add outlets" onClose={() => setAddingOutlet(false)}>
        <BulkOutletModal
          routes={data.routes}
          onDone={async (message) => {
            setAddingOutlet(false);
            setFlash({ kind: "success", text: message });
            await onSaved();
          }}
        />
      </Modal>

      <Modal open={!!deletingOutlet} title="Delete this outlet?" onClose={() => setDeletingOutlet(null)}>
        {deletingOutlet && (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl bg-warning p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
              <div className="text-sm">
                <p className="font-semibold">{deletingOutlet.outletName}</p>
                <p className="mt-1 text-foreground">
                  Refused if it has any order history — hide it instead to keep it out of order-taking without losing its records.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn btn-secondary h-12 text-base" onClick={() => setDeletingOutlet(null)}>
                Keep outlet
              </button>
              <button
                className="btn h-12 bg-danger-foreground text-base text-white hover:bg-danger-foreground"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Yes, delete
              </button>
            </div>
          </div>
        )}
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

