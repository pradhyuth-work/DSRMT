"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, HandCoins, History, Loader2, RotateCcw, Search, Trash2, Wallet2 } from "lucide-react";
import type { AuthUser, BounceChequeResponse, ChequeEventDTO, OutletDTO, PaymentDTO, ReflectChequeResponse, StaffDTO } from "@/lib/types";
import { CHEQUE_BOUNCE_FEE, formatMoney, round2 } from "@/lib/money";
import { api } from "./api-client";
import { Alert, EmptyState, Modal, PAGE_SIZE, Pagination, StatCard, formatDate, usePagination } from "./ui";
import { DateRangeFilter, type DateRange } from "./date-range";
import { CollectPaymentForm, type CollectPaymentTarget } from "./payment-form";
import { Combobox } from "./Combobox";

/** CHEQUE, NET_BANKING and VOUCHER payments can all be split across several entries
 * (cheques / transfers / vouchers) — see payment-form.tsx. */
const MULTI_ENTRY_METHODS = new Set(["CHEQUE", "NET_BANKING", "VOUCHER"]);

/**
 * One line in the list. A payment that settled several invoices is stored as several payment
 * rows (one per invoice), so rows sharing a chequeGroupId are shown as a single line; every
 * other payment is a line of its own.
 */
interface PaymentLine {
  key: string;
  rows: PaymentDTO[];
  /** Set for cheque/net-banking/voucher lines. Flag bounce / Reflect again only ever apply
   * when the method is CHEQUE — see render below. */
  groupId: string | null;
  amount: number;
  invoiceLabel: string;
  bounced: boolean;
}

function buildLines(payments: PaymentDTO[]): PaymentLine[] {
  const lines: PaymentLine[] = [];
  const byGroup = new Map<string, PaymentLine>();
  for (const p of payments) {
    const groupId = MULTI_ENTRY_METHODS.has(p.paymentMethod) ? p.chequeGroupId : null;
    const existing = groupId ? byGroup.get(groupId) : undefined;
    if (existing) {
      existing.rows.push(p);
      continue;
    }
    const line: PaymentLine = { key: groupId ?? p.id, rows: [p], groupId, amount: 0, invoiceLabel: "", bounced: false };
    if (groupId) byGroup.set(groupId, line);
    lines.push(line);
  }
  for (const l of lines) {
    l.amount = round2(l.rows.reduce((s, r) => s + r.amount, 0));
    l.invoiceLabel = [...new Set(l.rows.map((r) => r.invoiceNumber ?? "Unbilled"))].join(", ");
    l.bounced = l.rows[0].paymentMethod === "CHEQUE" && l.rows[0].chequeStatus === "BOUNCED";
  }
  return lines;
}

type StatusFilter = "all" | "active-cheques" | "bounced-cheques";

/**
 * The payments ledger. Admin sees every collection, filterable by outlet, collector and
 * date. Stock incharge sees the payments they personally collected plus every cheque (the
 * server enforces this), so their view has no "collected by" filter to begin with.
 *
 * Admin and stock incharge can both flag any cheque as bounced (it stops counting as received
 * and the invoices it settled reopen) and reflect it again once it clears.
 */
export default function PaymentsView({ user, outlets, staff }: { user: AuthUser; outlets: OutletDTO[]; staff: StaffDTO[] }) {
  const isAdmin = user.role === "admin";
  const [outletId, setOutletId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [range, setRange] = useState<DateRange>({});
  const [payments, setPayments] = useState<PaymentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [deletingLine, setDeletingLine] = useState<PaymentLine | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [chequeAction, setChequeAction] = useState<{ line: PaymentLine; mode: "bounce" | "reflect" } | null>(null);
  const [historyLine, setHistoryLine] = useState<PaymentLine | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPayments(await api.payments({ outletId: outletId || undefined, staffId: isAdmin ? staffId || undefined : undefined, ...range }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments");
    } finally {
      setLoading(false);
    }
  }, [outletId, staffId, range, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const lines = useMemo(() => buildLines(payments ?? []), [payments]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) => {
      if (status !== "all") {
        if (!l.groupId || l.rows[0].paymentMethod !== "CHEQUE") return false;
        if (status === "bounced-cheques" ? !l.bounced : l.bounced) return false;
      }
      if (q && !l.invoiceLabel.toLowerCase().includes(q) && !l.rows[0].outletName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lines, status, search]);
  // A bounced cheque is not money received, so it is left out of the total.
  const received = lines.filter((l) => !l.bounced);
  const bouncedLines = lines.filter((l) => l.bounced);
  const total = round2(received.reduce((s, l) => s + l.amount, 0));
  const bouncedTotal = round2(bouncedLines.reduce((s, l) => s + l.amount, 0));
  const linesPage = usePagination(visible);

  async function downloadCsv() {
    setDownloading(true);
    setError(null);
    try {
      await api.downloadPaymentsCsv({ outletId: outletId || undefined, staffId: isAdmin ? staffId || undefined : undefined, ...range });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download CSV");
    } finally {
      setDownloading(false);
    }
  }

  async function confirmDelete() {
    if (!deletingLine) return;
    setDeleting(true);
    try {
      for (const row of deletingLine.rows) await api.deletePayment(row.id);
      setFlash(`Payment of ${formatMoney(deletingLine.amount)} from ${deletingLine.rows[0].outletName} reversed`);
      setDeletingLine(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete payment");
      await load();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {flash && <Alert kind="success">{flash}</Alert>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="input pl-9"
              placeholder="Search bill no. or outlet…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Combobox
            className="w-44"
            value={outletId}
            onChange={setOutletId}
            ariaLabel="Filter by outlet"
            placeholder="All outlets"
            options={[{ value: "", label: "All outlets" }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]}
          />
          {isAdmin && (
            <Combobox
              className="w-44"
              value={staffId}
              onChange={setStaffId}
              ariaLabel="Filter by who collected it"
              placeholder="Collected by anyone"
              options={[{ value: "", label: "Collected by anyone" }, ...staff.map((s) => ({ value: s.id, label: s.name }))]}
            />
          )}
          <Combobox
            className="w-44"
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            ariaLabel="Filter by cheque status"
            placeholder="All payments"
            options={[
              { value: "all", label: "All payments" },
              { value: "active-cheques", label: "Cheques: active" },
              { value: "bounced-cheques", label: "Cheques: bounced" },
            ]}
          />
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary sm:w-auto" onClick={() => void downloadCsv()} disabled={downloading}>
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download CSV
          </button>
          <button className="btn btn-primary sm:w-auto" onClick={() => setCollecting(true)}>
            <HandCoins className="h-4 w-4" /> Collect Payment
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label={`Total ${payments ? `(${received.length})` : ""}`} value={formatMoney(total)} icon={Wallet2} tone="lime" />
        <StatCard
          label={`Bounced, awaiting re-presentation ${payments ? `(${bouncedLines.length} cheque${bouncedLines.length === 1 ? "" : "s"})` : ""}`}
          value={formatMoney(bouncedTotal)}
          icon={AlertTriangle}
          tone="rose"
        />
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="card overflow-hidden">
        {loading && !payments ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-secondary">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Outlet</th>
                  {isAdmin && <th className="th">Collected by</th>}
                  <th className="th">Method</th>
                  <th className="th">Reference</th>
                  <th className="th">Invoice</th>
                  <th className="th">Status</th>
                  <th className="th">Notes</th>
                  <th className="th text-right">Amount</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {linesPage.pageItems.map((l) => {
                  const p = l.rows[0];
                  // Bounce/reflect-again is a bank-cheque concept — net-banking and voucher
                  // entries are still grouped as one line (see buildLines) but never show it.
                  const isChequeLine = !!l.groupId && p.paymentMethod === "CHEQUE";
                  return (
                    <tr key={l.key} className="hover:bg-secondary">
                      <td className="td whitespace-nowrap text-muted-foreground">{formatDate(p.createdAt)}</td>
                      <td className="td font-medium">{p.outletName}</td>
                      {isAdmin && <td className="td">{p.staffName}</td>}
                      <td className="td">{p.paymentMethod}</td>
                      <td className="td whitespace-nowrap text-xs text-muted-foreground">
                        {p.chequeNumber ? `#${p.chequeNumber}${p.chequeDate ? ` · ${formatDate(p.chequeDate)}` : ""}` : ""}
                      </td>
                      <td className="td font-mono text-xs">{l.invoiceLabel}</td>
                      <td className="td">
                        {isChequeLine ? (
                          <div className="space-y-0.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${
                                l.bounced ? "bg-danger text-danger-foreground" : "bg-success text-success-foreground"
                              }`}
                            >
                              {l.bounced ? "Bounced" : "Active"}
                            </span>
                            {l.bounced && p.chequeBouncedAt && (
                              <p className="text-xs text-muted-foreground">
                                {formatDate(p.chequeBouncedAt)}
                                {p.chequeBounceReason ? ` · ${p.chequeBounceReason}` : ""}
                              </p>
                            )}
                            {!l.bounced && p.chequeReflectedAt && (
                              <p className="text-xs text-muted-foreground">Reflected again {formatDate(p.chequeReflectedAt)}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="td max-w-48 truncate text-muted-foreground">{p.notes ?? ""}</td>
                      <td
                        className={`td text-right font-semibold tabular-nums ${
                          l.bounced ? "text-danger-foreground line-through" : "text-success-foreground"
                        }`}
                      >
                        {formatMoney(l.amount)}
                      </td>
                      <td className="td">
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          {isChequeLine && !l.bounced && (
                            <button
                              className="btn btn-secondary px-2.5 py-1 text-xs text-danger-foreground"
                              onClick={() => setChequeAction({ line: l, mode: "bounce" })}
                            >
                              Flag bounce
                            </button>
                          )}
                          {isChequeLine && l.bounced && (
                            <button
                              className="btn btn-secondary px-2.5 py-1 text-xs text-info-foreground"
                              onClick={() => setChequeAction({ line: l, mode: "reflect" })}
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Reflect again
                            </button>
                          )}
                          {isChequeLine && (
                            <button
                              className="rounded p-1.5 text-muted-foreground hover:bg-secondary"
                              onClick={() => setHistoryLine(l)}
                              aria-label="Cheque history"
                              title="Cheque history"
                            >
                              <History className="h-4 w-4" />
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              className="rounded p-1.5 text-muted-foreground hover:bg-danger hover:text-danger-foreground"
                              onClick={() => setDeletingLine(l)}
                              aria-label={`Delete payment of ${formatMoney(l.amount)} from ${p.outletName}`}
                              title="Delete payment"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {payments && visible.length === 0 && <EmptyState>No payments match these filters.</EmptyState>}
        <Pagination
          page={linesPage.page}
          totalPages={linesPage.totalPages}
          totalItems={linesPage.totalItems}
          pageSize={PAGE_SIZE}
          onPageChange={linesPage.setPage}
        />
      </div>

      <Modal open={!!deletingLine} title="Delete this payment?" onClose={() => setDeletingLine(null)}>
        {deletingLine && (
          <div className="space-y-5">
            <div className="rounded-xl bg-warning p-4 text-sm">
              <p className="font-semibold">{formatMoney(deletingLine.amount)} from {deletingLine.rows[0].outletName}</p>
              <p className="mt-1 text-foreground">
                {deletingLine.bounced
                  ? "This cheque is already flagged as bounced, so its record is removed and the outlet's balance does not change."
                  : "This reverses the payment — the amount is added back to the outlet's outstanding balance."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn btn-secondary h-12 text-base" onClick={() => setDeletingLine(null)}>
                Keep payment
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

      <Modal
        open={!!chequeAction}
        title={chequeAction?.mode === "bounce" ? "Flag this cheque as bounced?" : "Reflect this cheque again?"}
        onClose={() => setChequeAction(null)}
      >
        {chequeAction && (
          <ChequeActionDialog
            key={`${chequeAction.mode}-${chequeAction.line.key}`}
            line={chequeAction.line}
            mode={chequeAction.mode}
            onCancel={() => setChequeAction(null)}
            onDone={async (message) => {
              setChequeAction(null);
              setFlash(message);
              await load();
            }}
          />
        )}
      </Modal>

      <Modal open={!!historyLine} title="Cheque history" onClose={() => setHistoryLine(null)}>
        {historyLine && <ChequeHistory line={historyLine} />}
      </Modal>

      <Modal open={collecting} title="Collect payment" onClose={() => setCollecting(false)}>
        <CollectPaymentFlow
          outlets={outlets}
          user={user}
          staffOptions={isAdmin ? staff : undefined}
          onDone={async (message) => {
            setCollecting(false);
            setFlash(message);
            await load();
          }}
        />
      </Modal>
    </div>
  );
}

/**
 * Confirmation for Flag bounce / Reflect again, showing what will happen before anything does:
 * which invoices get the money back (or lose it) and the outlet's balance before and after. The
 * outlet balance here is the open-invoice balance the server settles against (the bounce
 * charge is added to the ledger on top of it, and is mentioned separately).
 */
function ChequeActionDialog({
  line,
  mode,
  onCancel,
  onDone,
}: {
  line: PaymentLine;
  mode: "bounce" | "reflect";
  onCancel: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const first = line.rows[0];
  const [reason, setReason] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bounce = mode === "bounce";

  useEffect(() => {
    let cancelled = false;
    api
      .outletLedger(first.outletId)
      .then((b) => !cancelled && setBalance(b.balance))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [first.outletId]);

  const after = balance === null ? null : round2(bounce ? balance + line.amount : balance - line.amount);
  const wouldOverpay = !bounce && balance !== null && balance < line.amount;

  async function confirm() {
    if (!line.groupId) return;
    setBusy(true);
    setError(null);
    try {
      if (bounce) {
        const r: BounceChequeResponse = await api.bounceCheque(line.groupId, { reason: reason.trim() || undefined });
        await onDone(
          `Cheque #${first.chequeNumber ?? ""} from ${first.outletName} flagged as bounced — ${formatMoney(r.amount)} added back to the balance, plus a ${formatMoney(r.fee)} bounce charge`,
        );
      } else {
        const r: ReflectChequeResponse = await api.reflectCheque(line.groupId);
        await onDone(`Cheque #${first.chequeNumber ?? ""} from ${first.outletName} reflected again — ${formatMoney(r.amount)} applied`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-xl p-4 text-sm ${bounce ? "bg-warning" : "bg-info"}`}>
        <p className="font-semibold">
          {formatMoney(line.amount)} · Cheque #{first.chequeNumber ?? "—"}
        </p>
        <p className="mt-0.5">
          {first.outletName}
          {first.chequeDate ? ` · dated ${formatDate(first.chequeDate)}` : ""}
        </p>
        <p className="mt-2">
          {bounce
            ? `The cheque stops counting as received and the amount is added back to the outlet's outstanding balance. A bounce charge of ${formatMoney(CHEQUE_BOUNCE_FEE)} is also added to the outlet's ledger. Nothing is deleted; you can reflect it again later.`
            : "Use this once the cheque has been re-presented and cleared. The money is applied to the invoices again and the balance drops. The bounce charge is not refunded."}
        </p>
      </div>

      <div>
        <span className="label">{bounce ? "Effect on invoices" : "Where the money goes"}</span>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-secondary">
              <tr>
                <th className="th">Invoice</th>
                <th className="th text-right">{bounce ? "Added back" : "Applied"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {line.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-mono text-xs">{r.invoiceNumber ?? "Unbilled"}</td>
                  <td className={`px-4 py-2 text-right font-semibold tabular-nums ${bounce ? "text-danger-foreground" : "text-success-foreground"}`}>
                    {formatMoney(r.amount)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2 font-semibold">Outlet balance</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {balance === null || after === null ? (
                    <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <span className="text-muted-foreground">{formatMoney(balance)}</span>
                      {" → "}
                      <span className="font-bold">{formatMoney(after)}</span>
                    </>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {!bounce && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            If an original invoice was paid meanwhile, the remainder is applied oldest-first to the outlet&apos;s other open invoices.
          </p>
        )}
      </div>

      {bounce && (
        <div>
          <label className="label" htmlFor="bounce-reason">Reason (optional)</label>
          <input
            id="bounce-reason"
            className="input"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Insufficient funds"
          />
        </div>
      )}

      {wouldOverpay && (
        <Alert kind="warning">
          This outlet now owes only {formatMoney(balance ?? 0)}, which is less than this cheque. Reflecting it would overpay, so it is blocked.
        </Alert>
      )}
      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3">
        <button className="btn btn-secondary h-12 text-base" onClick={onCancel} disabled={busy}>
          {bounce ? "Keep as received" : "Cancel"}
        </button>
        <button
          className={`btn h-12 text-base ${bounce ? "bg-danger-foreground text-white hover:bg-danger-foreground" : "btn-primary"}`}
          disabled={busy || wouldOverpay}
          onClick={() => void confirm()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : bounce ? <AlertTriangle className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
          {bounce ? "Yes, flag bounced" : "Yes, reflect again"}
        </button>
      </div>
    </div>
  );
}

/** Every bounce and reflect-again of one cheque — who did it, when, and why. */
function ChequeHistory({ line }: { line: PaymentLine }) {
  const [events, setEvents] = useState<ChequeEventDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!line.groupId) return;
    api.chequeHistory(line.groupId).then(setEvents).catch((err) => setError(err instanceof Error ? err.message : "Failed to load history"));
  }, [line.groupId]);

  const first = line.rows[0];
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-semibold">Cheque #{first.chequeNumber ?? "—"}</span> · {first.outletName} · {formatMoney(line.amount)}
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {!events && !error && (
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {events && events.length === 0 && <EmptyState>This cheque has never bounced.</EmptyState>}
      {events && events.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {events.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${
                    e.action === "BOUNCED" ? "bg-danger text-danger-foreground" : "bg-success text-success-foreground"
                  }`}
                >
                  {e.action === "BOUNCED" ? "Bounced" : "Reflected again"}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(e.createdAt)} · {e.staffName}
                  {e.reason ? ` · ${e.reason}` : ""}
                </p>
              </div>
              <div className="text-right tabular-nums">
                <p className="font-semibold">{formatMoney(e.amount)}</p>
                {e.fee > 0 && <p className="text-xs text-muted-foreground">+ {formatMoney(e.fee)} charge</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Field agent, then outlet picker — narrowing to that agent's outlets before loading its
 * balance, so collecting for a specific route's outlets doesn't mean hunting one out of
 * every outlet in the system. */
function CollectPaymentFlow({
  outlets,
  user,
  staffOptions,
  onDone,
}: {
  outlets: OutletDTO[];
  user: AuthUser;
  staffOptions?: StaffDTO[];
  onDone: (message: string) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState("");
  const [outletId, setOutletId] = useState("");
  const [target, setTarget] = useState<CollectPaymentTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agentOptions = useMemo(() => {
    const byId = new Map<string, string>();
    let hasUnassigned = false;
    for (const o of outlets) {
      if (o.agentId) byId.set(o.agentId, o.agentName ?? o.agentId);
      else hasUnassigned = true;
    }
    const opts = [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    if (hasUnassigned) opts.push({ value: "__none__", label: "No field agent assigned" });
    return opts;
  }, [outlets]);

  const outletsForAgent = useMemo(
    () => outlets.filter((o) => (agentId === "__none__" ? !o.agentId : o.agentId === agentId)),
    [outlets, agentId],
  );

  function pickAgent(id: string) {
    setAgentId(id);
    setOutletId("");
    setTarget(null);
    setError(null);
  }

  async function pick(id: string) {
    setOutletId(id);
    setTarget(null);
    setError(null);
    if (!id) return;
    setLoading(true);
    try {
      const b = await api.outletLedger(id);
      setTarget({ outletId: b.outletId, outletName: b.outletName, balance: b.balance, openInvoices: b.openInvoices });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load outlet balance");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="cp-agent">Field agent</label>
        <Combobox
          id="cp-agent"
          value={agentId}
          onChange={pickAgent}
          placeholder="Select field agent…"
          options={agentOptions}
        />
      </div>

      <div>
        <label className="label" htmlFor="cp-outlet">Outlet</label>
        <Combobox
          id="cp-outlet"
          value={outletId}
          onChange={(v) => void pick(v)}
          placeholder={agentId ? "Select outlet…" : "Select a field agent first"}
          disabled={!agentId}
          options={outletsForAgent.map((o) => ({ value: o.id, label: o.name }))}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading balance…
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {target && target.balance <= 0 && <Alert kind="warning">This outlet has no outstanding balance.</Alert>}
      {target && target.balance > 0 && <CollectPaymentForm target={target} user={user} staffOptions={staffOptions} onDone={onDone} />}
    </div>
  );
}
