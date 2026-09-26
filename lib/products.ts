import type { Product } from "@prisma/client";
import type { ProductDTO, Role } from "./types";

/** Field agents see only whether an item is in stock, never the exact count. */
export function toProductDTO(p: Product, role: Role): ProductDTO {
  const dto: ProductDTO = {
    id: p.id,
    name: p.name,
    unitPrice: p.unitPrice,
    inStock: p.stockQty > 0,
    createdAt: p.createdAt.toISOString(),
  };
  if (role !== "agent") dto.stockQty = p.stockQty;
  return dto;
}
