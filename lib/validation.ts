import { z } from "zod";
import type {
  CreatePaymentInput,
  CreateProductInput,
  CreateSaleInput,
  RestockInput,
} from "./types";

const money = z.coerce.number().finite().nonnegative();
const id = z.string().trim().min(1);
const paymentMethod = z.enum(["CASH", "UPI"]);

export const createSaleSchema = z.object({
  outletId: id,
  staffId: id,
  items: z
    .array(z.object({ productId: id, quantity: z.coerce.number().int().positive() }))
    .min(1, "Add at least one item"),
  paidAmount: money.default(0),
  paymentMethod: paymentMethod.default("CASH"),
  notes: z.string().trim().max(500).optional(),
}) satisfies z.ZodType<CreateSaleInput, z.ZodTypeDef, unknown>;

export const createPaymentSchema = z.object({
  outletId: id,
  staffId: id,
  amount: money.positive("Amount must be greater than zero"),
  paymentMethod,
  notes: z.string().trim().max(500).optional(),
}) satisfies z.ZodType<CreatePaymentInput, z.ZodTypeDef, unknown>;

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  unitPrice: money.positive("Price must be greater than zero"),
  stockQty: z.coerce.number().int().nonnegative().default(0),
}) satisfies z.ZodType<CreateProductInput, z.ZodTypeDef, unknown>;

export const restockSchema = z.object({
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
}) satisfies z.ZodType<RestockInput, z.ZodTypeDef, unknown>;
