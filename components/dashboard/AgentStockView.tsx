"use client";

import { useState } from "react";
import type { AuthUser } from "@/lib/types";
import AgentIssueView from "./AgentIssueView";
import AgentBalancesView from "./AgentBalancesView";
import type { DashboardData } from "./Dashboard";

/** Issue stock and Agent balances on one page, switched with the same pills as Orders. */
export default function AgentStockView({ data, user, onSaved }: { data: DashboardData; user: AuthUser; onSaved: () => Promise<void> }) {
  const [view, setView] = useState<"issue" | "balances">("issue");
  const views = [
    { id: "issue", label: "Issue stock" },
    { id: "balances", label: "Agent balances" },
  ] as const;
  return (
    <div className="space-y-6">
      <div className="flex gap-2 overflow-x-auto">
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              view === v.id ? "border-primary bg-primary text-white" : "border-input bg-card text-muted-foreground hover:bg-secondary"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "issue" ? <AgentIssueView data={data} onSaved={onSaved} /> : <AgentBalancesView user={user} onSaved={onSaved} />}
    </div>
  );
}
