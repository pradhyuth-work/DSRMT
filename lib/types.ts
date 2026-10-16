// Shared request/response contracts used by both API routes and the dashboard UI.

export type InvoiceStatus = "PAID" | "PARTIAL" | "UNPAID";
/** UPI is read-only history — kept so old payments still display correctly, but never offered when recording a new one. */
export type PaymentMethod = "CASH" | "CHEQUE" | "NET_BANKING" | "VOUCHER" | "UPI";
/** Selectable when recording a new payment. */
export const PAYMENT_METHODS = ["CASH", "CHEQUE", "NET_BANKING", "VOUCHER"] as const satisfies readonly PaymentMethod[];
export type Role = "admin" | "stock" | "agent";
export type FulfilmentStatus = "PENDING" | "BILLED" | "DISPATCHED" | "CANCELLED";
export type StockMovementType = "RECEIVE" | "ADJUST" | "DISPATCH" | "CANCEL_RETURN";

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: Role;
}

export interface LoginInput {
  username: string;
  pin: string;
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
  /** Promotional per-unit price for "with scheme" orders — null if never set, or if scheme
   * pricing is currently switched off for this product (see schemeActive). */
  schemePrice: number | null;
  /** Whether schemePrice is currently active. Admin-only (schemePrice already reflects it
   * for every other purpose — pricing, availability checks — so other roles don't need it). */
  schemeActive?: boolean;
  /** The scheme price kept in storage even while schemeActive is false, so the Stock UI can
   * reactivate it without asking for the number again. Admin-only. */
  schemeStoredPrice?: number | null;
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
  /** Soft-hidden from order-taking pickers; still visible (and editable) in outlet management and every report. */
  hidden: boolean;
}

export interface HideOutletInput {
  hidden: boolean;
}

export type BalanceAdjustmentMode = "set" | "adjust";

export interface CorrectBalanceInput {
  mode: BalanceAdjustmentMode;
  /** The target balance for "set"; the signed amount to apply for "adjust". */
  value: number;
  reason: string;
}

export interface BalanceAdjustmentDTO {
  id: string;
  outletId: string;
  outletName: string;
  oldBalance: number;
  newBalance: number;
  delta: number;
  mode: BalanceAdjustmentMode;
  reason: string;
  createdByName: string;
  createdAt: string;
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
  /** Age of the single oldest open invoice, in days — null when there's nothing outstanding. */
  oldestInvoiceDays: number | null;
  openInvoices: { id: string; invoiceNumber: string | null; balanceDue: number; createdAt: string; daysOutstanding: number }[];
}

/** One row of the admin+stock "who owes money" list — OutletBalanceDTO plus just enough to
 * display and find the outlet, without the full reports view's company-wide and
 * staff-performance figures (admin only). */
export interface OutletCreditDTO extends OutletBalanceDTO {
  phone: string;
  routeName: string | null;
  /** Derived from the outlet's route, if any — lets stock filter this list by field agent. */
  agentId: string | null;
  agentName: string | null;
}

export interface StaffDTO {
  id: string;
  name: string;
  phone: string;
  username: string | null;
  role: Role;
  active: boolean;
  /** True when the person has both a username and a PIN set. */
  canLogin: boolean;
}

export interface CreateStaffInput {
  name: string;
  phone: string;
  username: string;
  pin: string;
  role: Role;
}

export interface UpdateStaffInput {
  name?: string;
  phone?: string;
  username?: string;
  role?: Role;
  active?: boolean;
}

export interface ResetPinInput {
  pin: string;
}

export interface ResetPinResponse {
  /** Returned when admins reset their own PIN, since their old token stops working. */
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
  /** Prices every line off Product.schemePrice instead of unitPrice. Every item's product must have one set. */
  hasScheme?: boolean;
}

export interface CreateSaleResponse {
  invoice: {
    id: string;
    totalAmount: number;
    paidAmount: number;
    balanceDue: number;
    status: InvoiceStatus;
    fulfilmentStatus: FulfilmentStatus;
    hasScheme: boolean;
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
  /** The manually-entered bill-book number. Null until the order is billed. */
  invoiceNumber: string | null;
  outletId: string;
  outletName: string;
  staffId: string;
  staffName: string;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  status: InvoiceStatus;
  fulfilmentStatus: FulfilmentStatus;
  /** Whether this order is priced with scheme rates. Toggleable by anyone while PENDING; locked once billed. */
  hasScheme: boolean;
  createdAt: string;
  billedAt: string | null;
  billedByName: string | null;
  dispatchedAt: string | null;
  dispatchedByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  items: OrderItemDTO[];
}

export interface BillOrderInput {
  invoiceNumber: string;
  /** The bill-book amount, copied in by hand alongside the number — becomes the order's
   * totalAmount/balanceDue from here on, the figure payments are collected against. */
  amount: number;
}

export interface UpdateOrderInput {
  outletId?: string;
  items?: SaleItemInput[];
}

export interface ToggleSchemeInput {
  hasScheme: boolean;
}

export interface DispatchBulkInput {
  orderIds: string[];
}

export interface DispatchBulkResponse {
  orders: OrderDTO[];
}

export interface UpdateProductInput {
  name?: string;
  unitPrice?: number;
  /** Pass null to clear it — also switches schemeActive off. Setting a value switches it
   * back on, unless schemeActive is passed explicitly alongside it. */
  schemePrice?: number | null;
  /** Flips scheme pricing on/off without touching the stored price. */
  schemeActive?: boolean;
}

export interface ToggleAllSchemesInput {
  active: boolean;
}

export interface ToggleAllSchemesResponse {
  count: number;
  active: boolean;
}

export interface ChangeProductCodeInput {
  newCode: number;
}

export interface AdjustStockInput {
  /** Signed change: positive adds stock, negative removes it. */
  change: number;
  reason: string;
}

export type StockMovementDirection = "IN" | "OUT";

export interface StockMovementDTO {
  id: string;
  productId: string;
  productName: string;
  change: number;
  type: StockMovementType;
  /** Derived from type (and, for ADJUST, the sign of change) — RECEIVE/CANCEL_RETURN and a
   * positive ADJUST are "IN"; DISPATCH and a negative ADJUST are "OUT". */
  direction: StockMovementDirection;
  reason: string | null;
  supplierRef: string | null;
  invoiceId: string | null;
  staffName: string;
  createdAt: string;
}

export interface StockMovementsQuery {
  productId?: string;
  from?: string;
  to?: string;
}

export interface CreatePaymentInput {
  outletId: string;
  /** Who received it — an admin or stock incharge. Defaults to the signed-in user; ignored
   * for the stock role (always attributed to itself). */
  staffId?: string;
  /** Ignored for CHEQUE payments, where the total is the sum of `cheques`. */
  amount?: number;
  paymentMethod: PaymentMethod;
  /** Required (at least one) for CHEQUE payments. */
  cheques?: ChequeInput[];
  notes?: string;
}

export interface ChequeInput {
  serialNumber: string;
  /** YYYY-MM-DD, the date written on the cheque. */
  date: string;
  amount: number;
}

export interface PaymentAllocation {
  invoiceId: string;
  invoiceNumber: string | null;
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
  invoiceNumber: string | null;
  amount: number;
  paymentMethod: PaymentMethod;
  chequeNumber: string | null;
  chequeDate: string | null;
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
  /** Matched case-insensitively against existing product names: a match restocks it, no match creates a new product. */
  name: string;
  /** Required only when the name doesn't match an existing product (i.e. a new product is created). */
  unitPrice?: number;
  quantity: number;
}

export interface BulkReceiveInput {
  rows: BulkReceiveRow[];
  /** Applied to every StockMovement row this upload creates — one supplier bill covering the whole batch. */
  supplierRef?: string;
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

export interface BulkRateRow {
  /** Existing product name (matched case-insensitively). */
  name: string;
  unitPrice: number;
}

export interface BulkRateInput {
  rows: BulkRateRow[];
}

export interface BulkRateResultRow {
  row: number;
  productId: string;
  productCode: number;
  productName: string;
  unitPrice: number;
}

export interface BulkRateResponse {
  results: BulkRateResultRow[];
}

export interface BulkAdjustRow {
  /** Existing product name (matched case-insensitively). */
  name: string;
  /** Signed change: positive adds stock, negative removes it. */
  change: number;
  reason: string;
}

export interface BulkAdjustInput {
  rows: BulkAdjustRow[];
}

export interface BulkAdjustResultRow {
  row: number;
  productId: string;
  productCode: number;
  productName: string;
  change: number;
  newStockQty: number;
}

export interface BulkAdjustResponse {
  results: BulkAdjustResultRow[];
}

export interface RestockInput {
  quantity: number;
  reason?: string;
  /** The supplier's bill/reference for this receipt — free text, optional. */
  supplierRef?: string;
}

export interface DashboardMetrics {
  totalBilled: number;
  totalCollected: number;
  totalOutstanding: number;
  totalStockValue: number;
  invoiceCount: number;
  /** Outlets whose single oldest unpaid invoice is past DAYS_CRITICAL_THRESHOLD (lib/money.ts). */
  outletsOver30Days: number;
}

export interface LedgerEntry {
  date: string;
  type: "INVOICE" | "PAYMENT" | "ADJUSTMENT";
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
  hidden: boolean;
  totalBilled: number;
  totalPaid: number;
  /** Sum of every open invoice's balance plus every manual correction's net effect — the true all-time ledger total. */
  balance: number;
  /** Age of the single oldest open invoice, in days — null when there's nothing outstanding. */
  oldestInvoiceDays: number | null;
  /** Unsettled invoices, oldest first — the order payments are applied in. */
  openInvoices: { id: string; invoiceNumber: string | null; balanceDue: number; createdAt: string; daysOutstanding: number }[];
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
  chequeCollected: number;
  netBankingCollected: number;
  voucherCollected: number;
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
  /** Age, in days, of the oldest invoice in this range that still has a balance due — null if none. */
  oldestInvoiceDays: number | null;
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

export interface SchemeSavingsQuery {
  from?: string;
  to?: string;
  outletId?: string;
  productId?: string;
  staffId?: string;
}

/** One row of a Scheme Savings breakdown table — by outlet, product, agent or month.
 * `id`/`name` are the group's key and label (for byMonth: "2026-01" and "Jan 2026"). */
export interface SchemeSavingsBreakdownRow {
  id: string;
  name: string;
  billed: number;
  atScheme: number;
  saved: number;
  pctSaved: number;
}

/** One line of a bill, for the Bills-tab drill-down modal. `saved` is 0 (not meaningfully
 * computable) when schemeUnitPrice is null. */
export interface SchemeSavingsBillLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  schemeUnitPrice: number | null;
  schemeEstimated: boolean;
  saved: number;
}

export interface SchemeSavingsBillRow {
  invoiceId: string;
  invoiceNumber: string | null;
  outletName: string;
  agentName: string;
  billedAt: string;
  billedAmount: number;
  atScheme: number;
  saved: number;
  items: SchemeSavingsBillLine[];
}

/**
 * Scheme Savings: what billing at the normal price instead of scheme saved, on bills where
 * `hasScheme` is false. `given` (the same figure on `hasScheme = true` bills) is shown for
 * context only — it's not folded into `billed`/`atScheme`/`saved`/the breakdowns/`bills`,
 * all of which are scoped to the no-scheme population. `net = saved - given`.
 */
export interface SchemeSavingsResponse {
  billed: number;
  atScheme: number;
  saved: number;
  given: number;
  net: number;
  /** `saved` as a percentage of `billed` — 0 when `billed` is 0. */
  pctSaved: number;
  /** Number of no-scheme bills counted (i.e. `bills.length`). */
  billCount: number;
  /** Lines with no scheme price captured at all — skipped from saved/given entirely. */
  noSchemeLines: number;
  /** Lines whose scheme price was back-filled (migration 0012) rather than captured live at billing. */
  estimatedLines: number;
  byOutlet: SchemeSavingsBreakdownRow[];
  byProduct: SchemeSavingsBreakdownRow[];
  byAgent: SchemeSavingsBreakdownRow[];
  byMonth: SchemeSavingsBreakdownRow[];
  bills: SchemeSavingsBillRow[];
}

export interface ApiError {
  error: string;
  details?: unknown;
}
