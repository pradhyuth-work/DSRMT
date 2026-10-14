"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownCircle, History, PackagePlus } from "lucide-react";
import type { ProductDTO, StockMovementDTO } from "@/lib/types";
import { api } from "./api-client";
import { Alert, EmptyState, PAGE_SIZE, Pagination, formatDate, usePagination } from "./ui";
import { DateRangeFilter, type DateRange } from "./date-range";
import BulkReceiveModal from "./BulkReceiveModal";

/**
 * Admin-only purchase-inwarding workspace: the bulk-receive form (previously a Stock-tab
 * modal) plus its own history, scoped to RECEIVE movements only — everything else on the
 * combined Stock movements log (dispatches, adjustments) is noise here. The movements prop
 * is the unfiltered recent log loaded with the rest of the dashboard; picking a date range
 * fetches a scoped list instead, same self-fetch pattern used in Stock.
 */
export default function InventoryInwarding({
  products,
  movements,
  onSaved,
}: {
  products: ProductDTO[];
  movements: StockMovementDTO[];
  onSaved: () => Promise<void>;
}) {
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [range, setRange] = useState<DateRange>({});
  const [rangedMovements, setRangedMovements] = useState<StockMovementDTO[] | null>(null);
  const [movementsError, setMovementsError] = useState<string | null>(null);

  const loadRanged = useCallback(async () => {
    if (!range.from && !range.to) {
      setRangedMovements(null);
      return;
    }
    try {
      setRangedMovements(await api.stockMovements(range));
      setMovementsError(null);
    } catch (err) {
      setMovementsError(err instanceof Error ? err.message : "Failed to load inward history");
    }
  }, [range]);

  useEffect(() => {
    void loadRanged();
  }, [loadRanged]);

  const receipts = (rangedMovements ?? movements).filter((m) => m.type === "RECEIVE");
  const page = usePagination(receipts);

  async function done(text: string) {
    setMessage({ kind: "success", text });
    await onSaved();
  }

  return (
    <div className="space-y-6">
      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      <div className="card p-5">
        <div className="mb-4">
          <p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-muted-foreground">Inwarding</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-bold tracking-[-.02em]">
            <PackagePlus className="h-5 w-5 text-primary" /> Record inventory purchase
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Post an incoming bill and increase warehouse stock immediately.</p>
        </div>
        <BulkReceiveModal products={products} onDone={done} />
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <History className="h-4 w-4 text-primary" /> Inward history
          </h2>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
        {movementsError && (
          <div className="px-5 py-3">
            <Alert kind="error">{movementsError}</Alert>
          </div>
        )}
        {receipts.length === 0 ? (
          <EmptyState>No inwards {range.from || range.to ? "in this range" : "yet"}.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {page.pageItems.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="flex min-w-0 items-start gap-2">
                  <ArrowDownCircle className="mt-0.5 h-4 w-4 shrink-0 text-success-foreground" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.supplierRef || "No supplier reference"}
                      {m.reason && <> · {m.reason}</>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(m.createdAt)} · {m.staffName}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-success-foreground">+{m.change}</span>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page.page} totalPages={page.totalPages} totalItems={page.totalItems} pageSize={PAGE_SIZE} onPageChange={page.setPage} />
      </div>
    </div>
  );
}
