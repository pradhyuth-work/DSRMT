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
  /** Human-facing sequential number shown and sorted on in the UI. */
  productCode: number;
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
  address: string;
  gstNumber: string | null;
  routeId: string | null;
  routeName: string | null;
  /** Derived from the outlet's route, if any. */
  agentId: string | null;
  agentName: string | null;
}

export interface UpdateOutletInput {
  name?: string;
  phone?: string;
  address?: string;
  gstNumber?: string | null;
  routeId?: string | null;
}

export interface BulkOutletRow {
  name: string;
  phone?: string;
  address?: string;
  gstNumber?: string;
  /** Matched by exact (case-insensitive) name against an existing route. Blank = no route. */
  routeName?: string;
}

export interface BulkOutletInput {
  rows: BulkOutletRow[];
}

export interface BulkOutletResultRow {
  row: number;
  outletId: string;
  outletName: string;
  routeName: string | null;
}

export interface BulkOutletResponse {
  results: BulkOutletResultRow[];
}

export interface RouteDTO {
  id: string;
  name: string;
  agentId: string | null;
  agentName: string | null;
  outletCount: number;
}

export interface CreateRouteInput {
  name: string;
  agentId: string | null;
}

export interface UpdateRouteInput {
  name?: string;
  agentId?: string | null;
}

/** Just enough of an outlet's ledger to collect a payment against it sensibly. */
export interface OutletBalanceDTO {
  outletId: string;
  outletName: string;
  balance: number;
  openInvoices: { id: string; balanceDue: number; createdAt: string }[];
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
  /** Required for admins; ignored for the stock role (always attributed to itself). */
  staffId?: string;
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

export interface PaymentDTO {
  id: string;
  outletId: string;
  outletName: string;
  staffId: string;
  staffName: string;
  invoiceId: string | null;
  amount: number;
  paymentMethod: PaymentMethod;
  notes: string | null;
  createdAt: string;
}

export interface PaymentsQuery {
  outletId?: string;
  /** Ignored server-side for the stock role, which always sees only its own collections. */
  staffId?: string;
  from?: string;
  to?: string;
}

export interface CreateProductInput {
  name: string;
  unitPrice: number;
  stockQty: number;
  /** Optional: if it collides with an existing product's code, that product (and every later one) shifts up by 1. */
  productCode?: number;
}

export interface BulkReceiveRow {
  /** Blank/omitted = create a new product at the next free code. */
  productCode?: number;
  name?: string;
  unitPrice?: number;
  quantity: number;
}

export interface BulkReceiveInput {
  rows: BulkReceiveRow[];
}

export interface BulkReceiveResultRow {
  row: number;
  action: "RESTOCK" | "CREATE";
  productId: string;
  productCode: number;
  productName: string;
  newStockQty: number;
}

export interface BulkReceiveResponse {
  results: BulkReceiveResultRow[];
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
  routeId: string | null;
  routeName: string | null;
  agentId: string | null;
  agentName: string | null;
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

export interface ReportsQuery {
  /** Date-filters staffPerformance only; dashboard totals and outlet ledgers stay all-time. */
  from?: string;
  to?: string;
}

export interface ReportsResponse {
  dashboard: DashboardMetrics;
  outletLedgers: OutletLedger[];
  staffPerformance: StaffPerformance[];
}

export interface SalesReportQuery {
  from?: string;
  to?: string;
  outletId?: string;
}

export interface ProductSalesRow {
  productId: string;
  productName: string;
  unitPrice: number;
  orders: number;
  qtySold: number;
  revenue: number;
  pctOfTotal: number;
}

export interface OutletSalesRow {
  outletId: string;
  outletName: string;
  orders: number;
  grossSales: number;
  paymentsReceived: number;
  balance: number;
}

export interface SkuMatrixResponse {
  outlets: { id: string; name: string; total: number }[];
  products: { id: string; name: string; total: number }[];
  /** cells[outletIndex][productIndex] = quantity sold, aligned to the outlets/products arrays above. */
  cells: number[][];
}

export interface SalesReportResponse {
  ordersCount: number;
  totalSales: number;
  totalPayments: number;
  byProduct: ProductSalesRow[];
  byOutlet: OutletSalesRow[];
  skuMatrix: SkuMatrixResponse;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
