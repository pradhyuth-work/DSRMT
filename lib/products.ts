import type { Product, StockMovement, StockMovementType } from "@prisma/client";
import type { ProductDTO, Role, StockMovementDTO, StockMovementDirection } from "./types";

/** The price actually usable for "with scheme" orders — null unless a price is both set
 * and switched on. Everything outside Stock management (order pricing, availability
 * checks) should go through this rather than the raw schemePrice column. */
export function effectiveSchemePrice(p: { schemePrice: number | null; schemeActive: boolean }): number | null {
  return p.schemeActive ? p.schemePrice : null;
}

/** Field agents see only whether an item is in stock, never the exact count. */
export function toProductDTO(p: Product, role: Role): ProductDTO {
  const dto: ProductDTO = {
    id: p.id,
    productCode: p.productCode,
    name: p.name,
    unitPrice: p.unitPrice,
    schemePrice: effectiveSchemePrice(p),
    inStock: p.stockQty > 0,
    createdAt: p.createdAt.toISOString(),
  };
  if (role !== "agent") dto.stockQty = p.stockQty;
  if (role === "admin") {
    dto.schemeActive = p.schemeActive;
    dto.schemeStoredPrice = p.schemePrice;
  }
  return dto;
}

/** RECEIVE/CANCEL_RETURN always add stock back; DISPATCH/BILL always take it out; ADJUST goes
 * either way depending on the sign of the (already-signed) change it recorded. */
export function directionFor(type: StockMovementType, change: number): StockMovementDirection {
  if (type === "DISPATCH" || type === "BILL") return "OUT";
  if (type === "RECEIVE" || type === "CANCEL_RETURN") return "IN";
  return change >= 0 ? "IN" : "OUT";
}

export function toStockMovementDTO(m: StockMovement & { product: { name: string }; staff: { name: string } }): StockMovementDTO {
  return {
    id: m.id,
    productId: m.productId,
    productName: m.product.name,
    change: m.change,
    type: m.type,
    direction: directionFor(m.type, m.change),
    reason: m.reason,
    supplierRef: m.supplierRef,
    invoiceId: m.invoiceId,
    staffName: m.staff.name,
    createdAt: m.createdAt.toISOString(),
  };
}
