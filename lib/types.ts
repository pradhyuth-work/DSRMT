// Shared request/response contracts used by both API routes and the dashboard UI.

export type InvoiceStatus = "PAID" | "PARTIAL" | "UNPAID";
export type PaymentMethod = "CASH" | "UPI";
export type Role = "admin" | "stock" | "agent";
export type FulfilmentStatus = "PENDING" | "DISPATCHED" | "CANCELLED";
export type StockMovementType = "RECEIVE" | "ADJUST" | "DISPATCH" | "CANCEL_RETURN";

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: Role;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface ProductDTO {
  id: string;
  name: string;
  unitPrice: number;
  /** Omitted for field agents, who only see whether an item is in stock. */
  stockQty?: number;
  inStock: boolean;
  createdAt: string;
}

export interface OutletDTO {
  id: string;
  name: string;
  phone: string;
}

export interface StaffDTO {
  id: string;
  name: string;
  phone: string;
  username: string | null;
  role: Role;
  active: boolean;
  /** True when the person has both a username and a password set. */
  canLogin: boolean;
}

export interface CreateStaffInput {
  name: string;
  phone: string;
  username: string;
  password: string;
  role: Role;
}

export interface UpdateStaffInput {
  name?: string;
  phone?: string;
  username?: string;
  role?: Role;
  active?: boolean;
}

export interface ResetPasswordInput {
  password: string;
}

export interface ResetPasswordResponse {
  /** Returned when admins reset their own password, since their old token stops working. */
  token?: string;
}

export interface SaleItemInput {
  productId: string;
  quantity: number;
}

export interface CreateSaleInput {
  outletId: string;
  /** Order owner. Required for admins; ignored for agents (always themselves). */
  staffId?: string;
  items: SaleItemInput[];
  paidAmount: number;
  paymentMethod: PaymentMethod;
  notes?: string;
}

export interface CreateSaleResponse {
  invoice: {
    id: string;
    totalAmount: number;
    paidAmount: number;
    balanceDue: number;
    status: InvoiceStatus;
    fulfilmentStatus: FulfilmentStatus;
    createdAt: string;
    items: { productId: string; productName: string; quantity: number; unitPrice: number; subtotal: number }[];
  };
}

export interface OrderItemDTO {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface OrderDTO {
  id: string;
  outletId: string;
  outletName: string;
  staffId: string;
  staffName: string;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  status: InvoiceStatus;
  fulfilmentStatus: FulfilmentStatus;
  createdAt: string;
  dispatchedAt: string | null;
  dispatchedByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  items: OrderItemDTO[];
}

export interface UpdateOrderInput {
  outletId?: string;
  items?: SaleItemInput[];
}

export interface UpdateProductInput {
  name?: string;
  unitPrice?: number;
}

export interface AdjustStockInput {
  /** Signed change: positive adds stock, negative removes it. */
  change: number;
  reason: string;
}

export interface StockMovementDTO {
  id: string;
  productId: string;
  productName: string;
  change: number;
  type: StockMovementType;
  reason: string | null;
  invoiceId: string | null;
  staffName: string;
  createdAt: string;
}

export interface CreatePaymentInput {
  outletId: string;
  staffId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  notes?: string;
}

export interface PaymentAllocation {
  invoiceId: string;
  applied: number;
  balanceDue: number;
  status: InvoiceStatus;
}

export interface CreatePaymentResponse {
  amount: number;
  allocations: PaymentAllocation[];
}

export interface CreateProductInput {
  name: string;
  unitPrice: number;
  stockQty: number;
}

export interface RestockInput {
  quantity: number;
  reason?: string;
}

export interface DashboardMetrics {
  totalBilled: number;
  totalCollected: number;
  totalOutstanding: number;
  totalStockUnits: number;
  invoiceCount: number;
}

export interface LedgerEntry {
  date: string;
  type: "INVOICE" | "PAYMENT";
  reference: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface OutletLedger {
  outletId: string;
  outletName: string;
  phone: string;
  totalBilled: number;
  totalPaid: number;
  balance: number;
  /** Unsettled invoices, oldest first — the order payments are applied in. */
  openInvoices: { id: string; balanceDue: number; createdAt: string }[];
  entries: LedgerEntry[];
}

export interface StaffPerformance {
  staffId: string;
  staffName: string;
  phone: string;
  totalOrders: number;
  totalSales: number;
  totalCollected: number;
  cashCollected: number;
  upiCollected: number;
  uncollectedBalance: number;
}

export interface ReportsResponse {
  dashboard: DashboardMetrics;
  outletLedgers: OutletLedger[];
  staffPerformance: StaffPerformance[];
}

export interface ApiError {
  error: string;
  details?: unknown;
}
