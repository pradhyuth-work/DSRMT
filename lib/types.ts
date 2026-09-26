// Shared request/response contracts used by both API routes and the dashboard UI.

export type InvoiceStatus = "PAID" | "PARTIAL" | "UNPAID";
export type PaymentMethod = "CASH" | "UPI";

export interface ProductDTO {
  id: string;
  name: string;
  unitPrice: number;
  stockQty: number;
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
}

export interface SaleItemInput {
  productId: string;
  quantity: number;
}

export interface CreateSaleInput {
  outletId: string;
  staffId: string;
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
    createdAt: string;
    items: { productId: string; productName: string; quantity: number; unitPrice: number; subtotal: number }[];
  };
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
