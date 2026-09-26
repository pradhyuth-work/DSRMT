import type {
  AdjustStockInput,
  ApiError,
  AuthUser,
  CreatePaymentInput,
  CreatePaymentResponse,
  CreateProductInput,
  CreateSaleInput,
  CreateSaleResponse,
  CreateStaffInput,
  FulfilmentStatus,
  LoginInput,
  LoginResponse,
  OrderDTO,
  OutletDTO,
  ProductDTO,
  ReportsResponse,
  ResetPasswordResponse,
  RestockInput,
  StaffDTO,
  StockMovementDTO,
  UpdateOrderInput,
  UpdateProductInput,
  UpdateStaffInput,
} from "@/lib/types";
import { getToken } from "./session";

let onUnauthorized: (() => void) | null = null;

/** Called when the server rejects the session (expired, disabled or password reset). */
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
    throw new Error(message);
  }
  return data as T;
}

const send = <T>(method: "POST" | "PATCH", url: string, body: unknown) =>
  request<T>(url, { method, body: JSON.stringify(body) });
const post = <T>(url: string, body: unknown = {}) => send<T>("POST", url, body);
const patch = <T>(url: string, body: unknown) => send<T>("PATCH", url, body);
const enc = encodeURIComponent;

export const api = {
  login: (input: LoginInput) => post<LoginResponse>("/api/auth/login", input),
  me: () => request<AuthUser>("/api/auth/me"),

  products: () => request<ProductDTO[]>("/api/products"),
  createProduct: (input: CreateProductInput) => post<ProductDTO>("/api/products", input),
  updateProduct: (id: string, input: UpdateProductInput) => patch<ProductDTO>(`/api/products/${enc(id)}`, input),
  restock: (productId: string, input: RestockInput) => post<ProductDTO>(`/api/products/${enc(productId)}/restock`, input),
  adjustStock: (productId: string, input: AdjustStockInput) =>
    post<ProductDTO>(`/api/products/${enc(productId)}/adjust`, input),
  stockMovements: () => request<StockMovementDTO[]>("/api/stock-movements"),

  outlets: () => request<OutletDTO[]>("/api/outlets"),
  reports: () => request<ReportsResponse>("/api/reports"),
  createPayment: (input: CreatePaymentInput) => post<CreatePaymentResponse>("/api/payments", input),

  createSale: (input: CreateSaleInput) => post<CreateSaleResponse>("/api/sales", input),
  orders: (status?: FulfilmentStatus) => request<OrderDTO[]>(`/api/orders${status ? `?status=${status}` : ""}`),
  updateOrder: (id: string, input: UpdateOrderInput) => patch<OrderDTO>(`/api/orders/${enc(id)}`, input),
  dispatchOrder: (id: string) => post<OrderDTO>(`/api/orders/${enc(id)}/dispatch`),
  cancelOrder: (id: string) => post<OrderDTO>(`/api/orders/${enc(id)}/cancel`),

  staff: () => request<StaffDTO[]>("/api/staff"),
  createStaff: (input: CreateStaffInput) => post<StaffDTO>("/api/staff", input),
  updateStaff: (id: string, input: UpdateStaffInput) => patch<StaffDTO>(`/api/staff/${enc(id)}`, input),
  resetPassword: (id: string, password: string) =>
    post<ResetPasswordResponse>(`/api/staff/${enc(id)}/password`, { password }),
};
