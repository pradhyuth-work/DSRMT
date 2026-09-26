"use client";

import { useState } from "react";
import { Loader2, Plus, Route as RouteIcon, Trash2 } from "lucide-react";
import type { RouteDTO, StaffDTO } from "@/lib/types";
import { api } from "./api-client";
import { Alert, EmptyState } from "./ui";
import { Combobox } from "./Combobox";

/**
 * Route CRUD: create, (re)assign the one field agent tied to it, and delete (only once
 * it has no outlets left on it — move them first).
 */
export default function RoutesManager({
  routes,
  agents,
  onSaved,
}: {
  routes: RouteDTO[];
  agents: StaffDTO[];
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // An agent already on another route can't be picked again from this list — the server
  // would just move them, but showing that up front avoids a surprising side effect.
  const takenAgentIds = new Set(routes.map((r) => r.agentId).filter((id): id is string => !!id));

  async function reassign(route: RouteDTO, agentId: string) {
    setBusyId(route.id);
    setError(null);
    try {
      await api.updateRoute(route.id, { agentId: agentId || null });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reassign route");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(route: RouteDTO) {
    if (route.outletCount > 0) return;
    if (!window.confirm(`Delete "${route.name}"?`)) return;
    setBusyId(route.id);
    setError(null);
    try {
      await api.deleteRoute(route.id);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete route");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}

      <AddRouteForm
        agents={agents}
        takenAgentIds={takenAgentIds}
        onDone={async () => {
          await onSaved();
        }}
      />

      {routes.length === 0 ? (
        <EmptyState>No routes yet — add one above.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {routes.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-xl border border-border bg-secondary p-3">
              <RouteIcon className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.outletCount} outlet{r.outletCount === 1 ? "" : "s"}</p>
              </div>
              <Combobox
                className="w-40"
                value={r.agentId ?? ""}
                disabled={busyId === r.id}
                onChange={(v) => void reassign(r, v)}
                ariaLabel={`Agent for ${r.name}`}
                placeholder="— Unassigned —"
                options={[
                  { value: "", label: "— Unassigned —" },
                  ...agents.map((a) => ({
                    value: a.id,
                    label: a.name,
                    disabled: takenAgentIds.has(a.id) && a.id !== r.agentId,
                    description: takenAgentIds.has(a.id) && a.id !== r.agentId ? "On another route" : undefined,
                  })),
                ]}
              />
              <button
                className="rounded-lg p-2 text-muted-foreground hover:bg-danger hover:text-danger-foreground disabled:opacity-30"
                disabled={r.outletCount > 0 || busyId === r.id}
                onClick={() => void remove(r)}
                title={r.outletCount > 0 ? "Move its outlets off this route first" : "Delete route"}
                aria-label={`Delete ${r.name}`}
              >
                {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddRouteForm({
  agents,
  takenAgentIds,
  onDone,
}: {
  agents: StaffDTO[];
  takenAgentIds: Set<string>;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createRoute({ name: name.trim(), agentId: agentId || null });
      setName("");
      setAgentId("");
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add route");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <input className="input flex-1" placeholder="New route name" value={name} onChange={(e) => setName(e.target.value)} />
      <Combobox
        className="sm:w-44"
        value={agentId}
        onChange={setAgentId}
        ariaLabel="Agent for new route"
        placeholder="— Unassigned —"
        options={[
          { value: "", label: "— Unassigned —" },
          ...agents.map((a) => ({
            value: a.id,
            label: a.name,
            disabled: takenAgentIds.has(a.id),
            description: takenAgentIds.has(a.id) ? "On another route" : undefined,
          })),
        ]}
      />
      <button type="submit" className="btn btn-primary sm:w-auto" disabled={!name.trim() || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add
      </button>
      {error && <p className="text-sm text-danger-foreground sm:basis-full">{error}</p>}
    </form>
  );
}
