import { z } from "zod";
import type {
  AdjustStockInput,
  BillOrderInput,
  BulkOutletInput,
  BulkRateInput,
  BulkReceiveInput,
  ChangeProductCodeInput,
  CorrectBalanceInput,
  CreatePaymentInput,
  CreateProductInput,
  CreateRouteInput,
  CreateSaleInput,
  CreateStaffInput,
  HideOutletInput,
  LoginInput,
  ResetPasswordInput,
  RestockInput,
  UpdateOrderInput,
  UpdateOutletInput,
  UpdateProductInput,
  UpdateRouteInput,
  UpdateStaffInput,
} from "./types";

const money = z.coerce.number().finite().nonnegative();
const id = z.string().trim().min(1);
// UPI is deliberately excluded — it's kept in the DB enum for historical rows only.
const paymentMethod = z.enum(["CASH", "CHEQUE", "NET_BANKING"]);
const role = z.enum(["admin", "stock", "agent"]);
const saleItems = z
  .array(z.object({ productId: id, quantity: z.coerce.number().int().positive() }))
  .min(1, "Add at least one item");
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, "Username must be 3–32 characters: letters, numbers, dot, dash or underscore");
const password = z.string().min(8, "Password must be at least 8 characters").max(128);
const personName = z.string().trim().min(1, "Name is required").max(80);
const phone = z.string().trim().max(20);
const address = z.string().trim().max(240);
// GSTIN is 15 alphanumeric characters; not validating the internal structure (state code,
// PAN, checksum, …) since real-world entries vary — just enough to catch obvious typos.
// An empty string means "no GST on file" and is treated the same as omitting it.
const gstNumber = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{15}$/, "GST number must be 15 characters")
    .nullable()
    .optional(),
);
const productCode = z.coerce.number().int().positive();
const dateStr = z.string().trim().min(1).pipe(z.coerce.date());
// A ledger balance can legitimately be negative (an outlet in credit), unlike `money`.
const signedMoney = z.coerce.number().finite();
const supplierRef = z.string().trim().max(120).optional();

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
}) satisfies z.ZodType<LoginInput, z.ZodTypeDef, unknown>;

export const createSaleSchema = z.object({
  outletId: id,
  staffId: id.optional(),
  items: saleItems,
  paidAmount: money.default(0),
  paymentMethod: paymentMethod.default("CASH"),
  notes: z.string().trim().max(500).optional(),
}) satisfies z.ZodType<CreateSaleInput, z.ZodTypeDef, unknown>;

export const updateOrderSchema = z
  .object({ outletId: id.optional(), items: saleItems.optional() })
  .refine((v) => v.outletId !== undefined || v.items !== undefined, "Nothing to update") satisfies z.ZodType<
  UpdateOrderInput,
  z.ZodTypeDef,
  unknown
>;

// The physical bill-book number, copied in by hand — free text (not every book uses plain
// digits), but bounded so it can't be pasted-in garbage.
export const billOrderSchema = z.object({
  invoiceNumber: z.string().trim().min(1, "Enter the bill number").max(40),
}) satisfies z.ZodType<BillOrderInput, z.ZodTypeDef, unknown>;

export const createPaymentSchema = z.object({
  outletId: id,
  // Required for admins (who choose which staff member collected it); ignored for the
  // stock role, which can only ever attribute a payment to itself.
  staffId: id.optional(),
  amount: money.positive("Amount must be greater than zero"),
  paymentMethod,
  notes: z.string().trim().max(500).optional(),
}) satisfies z.ZodType<CreatePaymentInput, z.ZodTypeDef, unknown>;

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  unitPrice: money.positive("Price must be greater than zero"),
  stockQty: z.coerce.number().int().nonnegative().default(0),
  productCode: productCode.optional(),
}) satisfies z.ZodType<CreateProductInput, z.ZodTypeDef, unknown>;

const bulkReceiveRowSchema = z.object({
  productCode: productCode.optional(),
  name: z.string().trim().max(120).optional(),
  unitPrice: money.positive("Price must be greater than zero").optional(),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
});

export const bulkReceiveSchema = z.object({
  rows: z.array(bulkReceiveRowSchema).min(1, "Add at least one row").max(500, "At most 500 rows per upload"),
  supplierRef,
}) satisfies z.ZodType<BulkReceiveInput, z.ZodTypeDef, unknown>;

const bulkRateRowSchema = z.object({
  productCode,
  unitPrice: money.positive("Price must be greater than zero"),
});

export const bulkRateSchema = z.object({
  rows: z.array(bulkRateRowSchema).min(1, "Add at least one row").max(500, "At most 500 rows per upload"),
}) satisfies z.ZodType<BulkRateInput, z.ZodTypeDef, unknown>;

export const changeProductCodeSchema = z.object({ newCode: productCode }) satisfies z.ZodType<
  ChangeProductCodeInput,
  z.ZodTypeDef,
  unknown
>;

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120).optional(),
    unitPrice: money.positive("Price must be greater than zero").optional(),
  })
  .refine((v) => v.name !== undefined || v.unitPrice !== undefined, "Nothing to update") satisfies z.ZodType<
  UpdateProductInput,
  z.ZodTypeDef,
  unknown
>;

export const restockSchema = z.object({
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  reason: z.string().trim().max(200).optional(),
  supplierRef,
}) satisfies z.ZodType<RestockInput, z.ZodTypeDef, unknown>;

export const adjustStockSchema = z.object({
  change: z.coerce
    .number()
    .int("Change must be a whole number")
    .refine((n) => n !== 0, "Change cannot be zero"),
  reason: z.string().trim().min(3, "Give a reason for the adjustment").max(200),
}) satisfies z.ZodType<AdjustStockInput, z.ZodTypeDef, unknown>;

export const createStaffSchema = z.object({
  name: personName,
  phone: phone.default(""),
  username,
  password,
  role,
}) satisfies z.ZodType<CreateStaffInput, z.ZodTypeDef, unknown>;

export const updateStaffSchema = z.object({
  name: personName.optional(),
  phone: phone.optional(),
  username: username.optional(),
  role: role.optional(),
  active: z.boolean().optional(),
}) satisfies z.ZodType<UpdateStaffInput, z.ZodTypeDef, unknown>;

export const resetPasswordSchema = z.object({ password }) satisfies z.ZodType<
  ResetPasswordInput,
  z.ZodTypeDef,
  unknown
>;

export const updateOutletSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120).optional(),
    phone: phone.optional(),
    address: address.optional(),
    gstNumber,
    routeId: id.nullable().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.phone !== undefined || v.address !== undefined || v.gstNumber !== undefined || v.routeId !== undefined,
    "Nothing to update",
  ) satisfies z.ZodType<UpdateOutletInput, z.ZodTypeDef, unknown>;

export const hideOutletSchema = z.object({ hidden: z.boolean() }) satisfies z.ZodType<HideOutletInput, z.ZodTypeDef, unknown>;

export const correctBalanceSchema = z
  .object({
    mode: z.enum(["set", "adjust"]),
    value: signedMoney,
    reason: z.string().trim().min(1, "A reason is required for a balance correction").max(200),
  })
  .refine((v) => v.mode !== "adjust" || v.value !== 0, {
    message: "Enter a non-zero amount to adjust by",
    path: ["value"],
  }) satisfies z.ZodType<CorrectBalanceInput, z.ZodTypeDef, unknown>;

const bulkOutletRowSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(240).optional(),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .refine((v) => !v || /^[0-9A-Z]{15}$/.test(v), "GST number must be 15 characters"),
  routeName: z.string().trim().max(120).optional(),
});

export const bulkOutletSchema = z.object({
  rows: z.array(bulkOutletRowSchema).min(1, "Add at least one row").max(500, "At most 500 rows per upload"),
}) satisfies z.ZodType<BulkOutletInput, z.ZodTypeDef, unknown>;

export const createRouteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  agentId: id.nullable(),
}) satisfies z.ZodType<CreateRouteInput, z.ZodTypeDef, unknown>;

export const updateRouteSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120).optional(),
    agentId: id.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.agentId !== undefined, "Nothing to update") satisfies z.ZodType<
  UpdateRouteInput,
  z.ZodTypeDef,
  unknown
>;

// Query-string schemas: every value arrives as a string (or is absent).
export const paymentsQuerySchema = z.object({
  outletId: id.optional(),
  staffId: id.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export const reportsQuerySchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export const salesReportQuerySchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  outletId: id.optional(),
});

export const stockMovementsQuerySchema = z.object({
  productId: id.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});
