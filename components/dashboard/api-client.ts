import type {
  AdjustStockInput,
  AgentBalanceDTO,
  AgentIssueDTO,
  AgentLedgerEntryDTO,
  RecordAgentPaymentResponse,
  CreateAgentIssueInput,
  SettleAgentInput,
  SettleAgentResponse,
  ApiError,
  AuthUser,
  BalanceAdjustmentDTO,
  BillOrderInput,
  EinvoiceReportDTO,
  EinvoiceSetupDTO,
  EinvoiceSetupInput,
  InvoiceSeriesDTO,
  ReverseBillInput,
  TaxReportTable,
  PosBillInput,
  BounceChequeInput,
  BounceChequeResponse,
  ChequeEventDTO,
  BulkAdjustInput,
  BulkAdjustResponse,
  BulkOutletInput,
  BulkOutletResponse,
  BulkRateInput,
  BulkRateResponse,
  BulkReceiveInput,
  BulkReceiveResponse,
  ChangeProductCodeInput,
  CorrectBalanceInput,
  CreatePaymentInput,
  CreatePaymentResponse,
  CreateProductInput,
  CreateSaleInput,
  CreateSaleResponse,
  CreateStaffInput,
  DispatchBulkInput,
  DispatchBulkResponse,
  FulfilmentStatus,
  HideOutletInput,
  LoginInput,
  LoginResponse,
  OrderDTO,
  OutletBalanceDTO,
  OutletCreditDTO,
  OutletDTO,
  PaymentDTO,
  PaymentsQuery,
  ProductDTO,
  ReportsQuery,
  ReportsResponse,
  ResetPinResponse,
  ReflectChequeResponse,
  RestockInput,
  RouteDTO,
  CreateRouteInput,
  UpdateRouteInput,
  MtDsrQuery,
  SalesReportQuery,
  SalesReportResponse,
  SchemeSavingsBillRow,
  SchemeSavingsQuery,
  SchemeSavingsResponse,
  StaffDTO,
  StockMovementDTO,
  StockMovementsQuery,
  ToggleAllSchemesResponse,
  UpdateOrderInput,
  UpdateOutletInput,
  UpdateProductInput,
  UpdateStaffInput,
} from "@/lib/types";
import { getToken } from "./session";

/** Thrown by every failed request. Carries the server's `details` payload (e.g. per-row bulk-upload errors). */
export class ApiRequestError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;

/** Called when the server rejects the session (expired, disabled or PIN reset). */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    const message = (data as ApiError | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiRequestError(message, (data as ApiError | null)?.details);
  }
  return data as T;
}

const send = <T>(method: "POST" | "PATCH", url: string, body: unknown) =>
  request<T>(url, { method, body: JSON.stringify(body) });
const post = <T>(url: string, body: unknown = {}) => send<T>("POST", url, body);
const patch = <T>(url: string, body: unknown) => send<T>("PATCH", url, body);
const enc = encodeURIComponent;

/** Builds a query string from a plain object, dropping undefined/empty values. */
function qs(params?: MtDsrQuery | ReportsQuery | PaymentsQuery | SalesReportQuery | SchemeSavingsQuery | StockMovementsQuery): string {
  if (!params) return "";
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
}

/** Downloads a file the browser can't reach with a plain <a href> because it needs the
 * bearer token — used for every CSV/JSON export. Reads the filename off Content-Disposition. */
async function downloadFile(path: string, fallbackName: string): Promise<Headers> {
  const token = getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    throw new ApiRequestError((data as ApiError | null)?.error ?? `Request failed (${res.status})`);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return res.headers;
}

/** Downloads the invoice as a PDF file named after the invoice number (e.g. MTR-312.pdf). */
async function downloadInvoicePdf(orderId: string): Promise<void> {
  await downloadFile(`/api/orders/${encodeURIComponent(orderId)}/pdf`, "invoice.pdf");
}

type DrawCmd =
  | { t: "text"; x: number; y: number; s: string; size: number; bold: boolean; right: boolean; gray: boolean }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; width: number; gray: boolean }
  | { t: "rect"; x: number; y: number; w: number; h: number; width: number }
  | { t: "image"; x: number; y: number; w: number; h: number };

/** Saves the invoice as a PNG image named after the invoice number (e.g. MTR-312.png). Several pages are stacked in one image. */
async function downloadInvoiceImage(orderId: string): Promise<void> {
  const layout = await request<{ name: string; w: number; h: number; pages: DrawCmd[][] }>(`/api/orders/${enc(orderId)}/image`);
  const logo = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/varasidhi-logo.png";
  });
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(layout.w * scale);
  canvas.height = Math.round(layout.h * scale * layout.pages.length);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ApiRequestError("Could not make the image on this device");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ink = "#0F2B29";
  const gray = "#5A6B6B";
  const light = "#C7D4D2";
  layout.pages.forEach((cmds, pi) => {
    ctx.save();
    ctx.translate(0, pi * layout.h * scale);
    ctx.scale(scale, scale);
    ctx.textBaseline = "alphabetic";
    for (const c of cmds) {
      if (c.t === "text") {
        ctx.fillStyle = c.gray ? gray : ink;
        ctx.font = `${c.bold ? "bold " : ""}${c.size}px Helvetica, Arial, sans-serif`;
        ctx.textAlign = c.right ? "right" : "left";
        ctx.fillText(c.s, c.x, c.y);
      } else if (c.t === "line") {
        ctx.strokeStyle = c.gray ? light : ink;
        ctx.lineWidth = c.width;
        ctx.beginPath();
        ctx.moveTo(c.x1, c.y1);
        ctx.lineTo(c.x2, c.y2);
        ctx.stroke();
      } else if (c.t === "rect") {
        ctx.strokeStyle = ink;
        ctx.lineWidth = c.width;
        ctx.strokeRect(c.x, c.y, c.w, c.h);
      } else if (logo) {
        ctx.drawImage(logo, c.x, c.y, c.w, c.h);
      }
    }
    ctx.restore();
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new ApiRequestError("Could not make the image on this device");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${layout.name}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opens the printable A5 invoice for a bill made in the app in a new window and starts printing. */
async function printInvoice(orderId: string): Promise<void> {
  const token = getToken();
  const w = window.open("", "_blank");
  if (!w) throw new ApiRequestError("Allow pop-ups to print the invoice");
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/print`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
    if (!res.ok) {
      const data: unknown = await res.json().catch(() => null);
      throw new ApiRequestError((data as ApiError | null)?.error ?? `Request failed (${res.status})`);
    }
    const html = (await res.text()).replace("<head>", `<head><base href="${window.location.origin}/">`);
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.addEventListener("load", () => setTimeout(() => w.print(), 300));
  } catch (e) {
    w.close();
    throw e;
  }
}

export const api = {
  printInvoice,
  downloadInvoicePdf,
  downloadInvoiceImage,
  login: (input: LoginInput) => post<LoginResponse>("/api/auth/login", input),
  me: () => request<AuthUser>("/api/auth/me"),

  products: () => request<ProductDTO[]>("/api/products"),
  createProduct: (input: CreateProductInput) => post<ProductDTO>("/api/products", input),
  updateProduct: (id: string, input: UpdateProductInput) => patch<ProductDTO>(`/api/products/${enc(id)}`, input),
  restock: (productId: string, input: RestockInput) => post<ProductDTO>(`/api/products/${enc(productId)}/restock`, input),
  adjustStock: (productId: string, input: AdjustStockInput) =>
    post<ProductDTO>(`/api/products/${enc(productId)}/adjust`, input),
  bulkReceive: (input: BulkReceiveInput) => post<BulkReceiveResponse>("/api/products/bulk-receive", input),
  bulkUpdateRates: (input: BulkRateInput) => post<BulkRateResponse>("/api/products/bulk-rate", input),
  bulkAdjustStock: (input: BulkAdjustInput) => post<BulkAdjustResponse>("/api/products/bulk-adjust", input),
  toggleAllSchemes: (active: boolean) => post<ToggleAllSchemesResponse>("/api/products/scheme-toggle", { active }),
  changeProductCode: (id: string, input: ChangeProductCodeInput) => patch<ProductDTO>(`/api/products/${enc(id)}/code`, input),
  deleteProduct: (id: string) => request<{ ok: true }>(`/api/products/${enc(id)}`, { method: "DELETE" }),
  stockMovements: (query?: StockMovementsQuery) => request<StockMovementDTO[]>(`/api/stock-movements${qs(query)}`),

  outlets: () => request<OutletDTO[]>("/api/outlets"),
  bulkCreateOutlets: (input: BulkOutletInput) => post<BulkOutletResponse>("/api/outlets/bulk-create", input),
  updateOutlet: (id: string, input: UpdateOutletInput) => patch<OutletDTO>(`/api/outlets/${enc(id)}`, input),
  hideOutlet: (id: string, input: HideOutletInput) => patch<OutletDTO>(`/api/outlets/${enc(id)}/hidden`, input),
  deleteOutlet: (id: string) => request<{ ok: true }>(`/api/outlets/${enc(id)}`, { method: "DELETE" }),
  outletLedger: (id: string) => request<OutletBalanceDTO>(`/api/outlets/${enc(id)}/ledger`),
  outletsInCredit: () => request<OutletCreditDTO[]>("/api/outlets/credit"),
  correctBalance: (id: string, input: CorrectBalanceInput) => patch<BalanceAdjustmentDTO>(`/api/outlets/${enc(id)}/balance`, input),
  balanceAdjustments: () => request<BalanceAdjustmentDTO[]>("/api/outlets/balance-adjustments"),

  routes: () => request<RouteDTO[]>("/api/routes"),
  createRoute: (input: CreateRouteInput) => post<RouteDTO>("/api/routes", input),
  updateRoute: (id: string, input: UpdateRouteInput) => patch<RouteDTO>(`/api/routes/${enc(id)}`, input),
  deleteRoute: (id: string) => request<{ ok: true }>(`/api/routes/${enc(id)}`, { method: "DELETE" }),

  reports: (query?: ReportsQuery) => request<ReportsResponse>(`/api/reports${qs(query)}`),
  salesReport: (query?: SalesReportQuery) => request<SalesReportResponse>(`/api/reports/sales${qs(query)}`),
  payments: (query?: PaymentsQuery) => request<PaymentDTO[]>(`/api/payments${qs(query)}`),
  createPayment: (input: CreatePaymentInput) => post<CreatePaymentResponse>("/api/payments", input),
  bounceCheque: (groupId: string, input: BounceChequeInput) =>
    post<BounceChequeResponse>(`/api/cheques/${enc(groupId)}/bounce`, input),
  reflectCheque: (groupId: string) => post<ReflectChequeResponse>(`/api/cheques/${enc(groupId)}/reflect`, {}),
  chequeHistory: (groupId: string) => request<ChequeEventDTO[]>(`/api/cheques/${enc(groupId)}`),
  deletePayment: (id: string) => request<{ ok: true }>(`/api/payments/${enc(id)}`, { method: "DELETE" }),
  downloadPaymentsCsv: (query?: PaymentsQuery) => downloadFile(`/api/payments/csv${qs(query)}`, "payments.csv"),
  /** Returns the names of products that had no column in the workbook (empty when all mapped). */
  downloadMtDsrXlsx: async (query: MtDsrQuery): Promise<string> =>
    decodeURIComponent((await downloadFile(`/api/reports/mt-dsr${qs(query)}`, "MT_DSR.xlsx")).get("X-Unmapped-Products") ?? ""),
  downloadSalesReportCsv: (query?: SalesReportQuery) => downloadFile(`/api/reports/sales/csv${qs(query)}`, "sales-report.csv"),

  agentBalances: () => request<AgentBalanceDTO[]>("/api/agent-balances"),
  agentLedger: (agentId: string) => request<AgentLedgerEntryDTO[]>(`/api/agent-balances/${enc(agentId)}/ledger`),
  agentIssues: () => request<AgentIssueDTO[]>("/api/agent-issues"),
  createAgentIssue: (input: CreateAgentIssueInput) => post<AgentIssueDTO>("/api/agent-issues", input),
  /** Any amount received from an agent, not calculated against items. */
  recordAgentPayment: (agentId: string, input: { amount: number; note?: string }) =>
    post<RecordAgentPaymentResponse>(`/api/agent-balances/${enc(agentId)}/payment`, input),
  settleAgent: (agentId: string, input: SettleAgentInput) =>
    post<SettleAgentResponse>(`/api/agent-balances/${enc(agentId)}/settle`, input),

  schemeSavings: (query?: SchemeSavingsQuery) => request<SchemeSavingsResponse>(`/api/scheme-savings${qs(query)}`),
  schemeSavingsBills: (query?: SchemeSavingsQuery) => request<SchemeSavingsBillRow[]>(`/api/scheme-savings/bills${qs(query)}`),
  downloadSchemeSavingsCsv: (query?: SchemeSavingsQuery) => downloadFile(`/api/scheme-savings/csv${qs(query)}`, "scheme-savings.csv"),

  createSale: (input: CreateSaleInput) => post<CreateSaleResponse>("/api/sales", input),
  orders: (status?: FulfilmentStatus) => request<OrderDTO[]>(`/api/orders${status ? `?status=${status}` : ""}`),
  downloadOrdersCsv: (status?: FulfilmentStatus) => downloadFile(`/api/orders/csv${status ? `?status=${status}` : ""}`, "orders.csv"),
  updateOrder: (id: string, input: UpdateOrderInput) => patch<OrderDTO>(`/api/orders/${enc(id)}`, input),
  getInvoiceSeries: () => request<InvoiceSeriesDTO>("/api/einvoice/series"),
  setInvoiceSeries: (next: number) => patch<InvoiceSeriesDTO>("/api/einvoice/series", { next }),
  getEinvoiceSetup: () => request<EinvoiceSetupDTO>("/api/einvoice/setup"),
  saveEinvoiceSetup: (input: EinvoiceSetupInput) => patch<EinvoiceSetupDTO>("/api/einvoice/setup", input),
  einvoiceReport: (q: { from: string; to: string; only?: "new" }) =>
    request<EinvoiceReportDTO>(`/api/einvoice/export?${new URLSearchParams({ format: "report", from: q.from, to: q.to, ...(q.only ? { only: q.only } : {}) })}`),
  /** Downloads the e-invoice JSON array; resolves with how many bills were left out as blocked. */
  downloadEinvoiceJson: async (q: { from: string; to: string; only?: "new" }) => {
    const h = await downloadFile(`/api/einvoice/export?${new URLSearchParams({ from: q.from, to: q.to, ...(q.only ? { only: q.only } : {}) })}`, "einvoice.json");
    return Number(h.get("X-Einvoice-Blocked") ?? 0);
  },
  /** One bill's e-invoice JSON. If it can't be made, says why (what the report lists as missing). */
  downloadEinvoiceForBill: async (id: string) => {
    try {
      await downloadFile(`/api/einvoice/export?ids=${enc(id)}`, "einvoice.json");
    } catch (e) {
      const r = await request<EinvoiceReportDTO>(`/api/einvoice/export?ids=${enc(id)}&format=report`).catch(() => null);
      const why = r?.rows[0]?.errors.join("; ");
      throw new ApiRequestError(why || (e instanceof Error ? e.message : "Could not make the JSON"));
    }
  },
  posBill: (input: PosBillInput) => post<OrderDTO>("/api/pos/bill", input),
  approveOutlet: (id: string) => post<OutletDTO>(`/api/outlets/${enc(id)}/approve`, {}),
  taxReportView: (type: string, month: string) => request<{ tables: TaxReportTable[] }>(`/api/tax/report?type=${enc(type)}&month=${enc(month)}&format=json`),
  taxReportDownload: (type: string, month: string) => downloadFile(`/api/tax/report?type=${enc(type)}&month=${enc(month)}`, `${type}-${month}`),
  reverseBill: (id: string, input: ReverseBillInput) => post<OrderDTO>(`/api/orders/${enc(id)}/reverse-bill`, input),
  billOrder: (id: string, input: BillOrderInput) => post<OrderDTO>(`/api/orders/${enc(id)}/bill`, input),
  toggleScheme: (id: string, productId: string, hasScheme: boolean) =>
    patch<OrderDTO>(`/api/orders/${enc(id)}/scheme`, { productId, hasScheme }),
  dispatchOrder: (id: string) => post<OrderDTO>(`/api/orders/${enc(id)}/dispatch`),
  dispatchBulk: (input: DispatchBulkInput) => post<DispatchBulkResponse>("/api/orders/dispatch-bulk", input),
  cancelOrder: (id: string) => post<OrderDTO>(`/api/orders/${enc(id)}/cancel`),

  staff: () => request<StaffDTO[]>("/api/staff"),
  createStaff: (input: CreateStaffInput) => post<StaffDTO>("/api/staff", input),
  updateStaff: (id: string, input: UpdateStaffInput) => patch<StaffDTO>(`/api/staff/${enc(id)}`, input),
  resetPin: (id: string, pin: string) =>
    post<ResetPinResponse>(`/api/staff/${enc(id)}/pin`, { pin }),

  downloadBackup: () => downloadFile("/api/backup", "dsrmt-backup.json"),
  /** Replaces the whole database with a backup file made by downloadBackup. Admin only. */
  restoreBackup: (backup: unknown) =>
    post<{ restoredRows: Record<string, number>; emptied: string[] }>("/api/backup/restore", { confirm: "RESTORE", backup }),
};
