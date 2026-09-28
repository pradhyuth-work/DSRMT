import type {
  AdjustStockInput,
  ApiError,
  AuthUser,
  BalanceAdjustmentDTO,
  BillOrderInput,
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
  OutletDTO,
  PaymentDTO,
  PaymentsQuery,
  ProductDTO,
  ReportsQuery,
  ReportsResponse,
  ResetPinResponse,
  RestockInput,
  RouteDTO,
  CreateRouteInput,
  UpdateRouteInput,
  SalesReportQuery,
  SalesReportResponse,
  StaffDTO,
  StockMovementDTO,
  StockMovementsQuery,
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
function qs(params?: ReportsQuery | PaymentsQuery | SalesReportQuery | StockMovementsQuery): string {
  if (!params) return "";
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
}

/** Downloads a file the browser can't reach with a plain <a href> because it needs the
 * bearer token — used for every CSV/JSON export. Reads the filename off Content-Disposition. */
async function downloadFile(path: string, fallbackName: string): Promise<void> {
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
}

export const api = {
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
  changeProductCode: (id: string, input: ChangeProductCodeInput) => patch<ProductDTO>(`/api/products/${enc(id)}/code`, input),
  deleteProduct: (id: string) => request<{ ok: true }>(`/api/products/${enc(id)}`, { method: "DELETE" }),
  stockMovements: (query?: StockMovementsQuery) => request<StockMovementDTO[]>(`/api/stock-movements${qs(query)}`),

  outlets: () => request<OutletDTO[]>("/api/outlets"),
  bulkCreateOutlets: (input: BulkOutletInput) => post<BulkOutletResponse>("/api/outlets/bulk-create", input),
  updateOutlet: (id: string, input: UpdateOutletInput) => patch<OutletDTO>(`/api/outlets/${enc(id)}`, input),
  hideOutlet: (id: string, input: HideOutletInput) => patch<OutletDTO>(`/api/outlets/${enc(id)}/hidden`, input),
  deleteOutlet: (id: string) => request<{ ok: true }>(`/api/outlets/${enc(id)}`, { method: "DELETE" }),
  outletLedger: (id: string) => request<OutletBalanceDTO>(`/api/outlets/${enc(id)}/ledger`),
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
  deletePayment: (id: string) => request<{ ok: true }>(`/api/payments/${enc(id)}`, { method: "DELETE" }),
  downloadPaymentsCsv: (query?: PaymentsQuery) => downloadFile(`/api/payments/csv${qs(query)}`, "payments.csv"),
  downloadSalesReportCsv: (query?: SalesReportQuery) => downloadFile(`/api/reports/sales/csv${qs(query)}`, "sales-report.csv"),

  createSale: (input: CreateSaleInput) => post<CreateSaleResponse>("/api/sales", input),
  orders: (status?: FulfilmentStatus) => request<OrderDTO[]>(`/api/orders${status ? `?status=${status}` : ""}`),
  downloadOrdersCsv: (status?: FulfilmentStatus) => downloadFile(`/api/orders/csv${status ? `?status=${status}` : ""}`, "orders.csv"),
  updateOrder: (id: string, input: UpdateOrderInput) => patch<OrderDTO>(`/api/orders/${enc(id)}`, input),
  billOrder: (id: string, input: BillOrderInput) => post<OrderDTO>(`/api/orders/${enc(id)}/bill`, input),
  dispatchOrder: (id: string) => post<OrderDTO>(`/api/orders/${enc(id)}/dispatch`),
  dispatchBulk: (input: DispatchBulkInput) => post<DispatchBulkResponse>("/api/orders/dispatch-bulk", input),
  cancelOrder: (id: string) => post<OrderDTO>(`/api/orders/${enc(id)}/cancel`),

  staff: () => request<StaffDTO[]>("/api/staff"),
  createStaff: (input: CreateStaffInput) => post<StaffDTO>("/api/staff", input),
  updateStaff: (id: string, input: UpdateStaffInput) => patch<StaffDTO>(`/api/staff/${enc(id)}`, input),
  resetPin: (id: string, pin: string) =>
    post<ResetPinResponse>(`/api/staff/${enc(id)}/pin`, { pin }),

  downloadBackup: () => downloadFile("/api/backup", "dsrmt-backup.json"),
};
