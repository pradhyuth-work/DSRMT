import type {
  ApiError,
  CreatePaymentInput,
  CreatePaymentResponse,
  CreateProductInput,
  CreateSaleInput,
  CreateSaleResponse,
  OutletDTO,
  ProductDTO,
  ReportsResponse,
  RestockInput,
  StaffDTO,
} from "@/lib/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as ApiError | null)?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

const post = <T>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) });

export const api = {
  products: () => request<ProductDTO[]>("/api/products"),
  outlets: () => request<OutletDTO[]>("/api/outlets"),
  staff: () => request<StaffDTO[]>("/api/staff"),
  reports: () => request<ReportsResponse>("/api/reports"),
  createSale: (input: CreateSaleInput) => post<CreateSaleResponse>("/api/sales", input),
  createPayment: (input: CreatePaymentInput) => post<CreatePaymentResponse>("/api/payments", input),
  createProduct: (input: CreateProductInput) => post<ProductDTO>("/api/products", input),
  restock: (productId: string, input: RestockInput) =>
    post<ProductDTO>(`/api/products/${encodeURIComponent(productId)}/restock`, input),
};
