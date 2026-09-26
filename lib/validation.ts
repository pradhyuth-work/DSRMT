import { z } from "zod";
import type {
  AdjustStockInput,
  BulkReceiveInput,
  CreateOutletInput,
  CreatePaymentInput,
  CreateProductInput,
  CreateSaleInput,
  CreateStaffInput,
  LoginInput,
  ResetPasswordInput,
  RestockInput,
  UpdateOrderInput,
  UpdateOutletInput,
  UpdateProductInput,
  UpdateStaffInput,
} from "./types";

const money = z.coerce.number().finite().nonnegative();
const id = z.string().trim().min(1);
const paymentMethod = z.enum(["CASH", "UPI"]);
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
const productCode = z.coerce.number().int().positive();
const dateStr = z.string().trim().min(1).pipe(z.coerce.date());

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
}) satisfies z.ZodType<BulkReceiveInput, z.ZodTypeDef, unknown>;

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

export const createOutletSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: phone.default(""),
  agentId: id.nullable(),
}) satisfies z.ZodType<CreateOutletInput, z.ZodTypeDef, unknown>;

export const updateOutletSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120).optional(),
    phone: phone.optional(),
    agentId: id.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.phone !== undefined || v.agentId !== undefined, "Nothing to update") satisfies z.ZodType<
  UpdateOutletInput,
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
