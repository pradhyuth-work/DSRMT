import { HttpError } from "@/lib/api";

/** One product line read off a supplier bill. */
export interface BillLine {
  /** Product description exactly as printed on the bill. */
  billText: string;
  /** The catalogue product this line is, or null when no catalogue product clearly matches. */
  productName: string | null;
  quantity: number;
  /** Anything the reader wants a human to double-check on this line (e.g. cases vs. pieces). */
  note?: string;
}

export interface BillReading {
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  lines: BillLine[];
  warnings: string[];
}

export const BILL_MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
/** Vercel caps request bodies at 4.5 MB; keep headroom for the multipart envelope. */
export const MAX_BILL_BYTES = 4 * 1024 * 1024;

const TOOL = {
  name: "record_bill",
  description: "Record the supplier bill that was read.",
  input_schema: {
    type: "object",
    properties: {
      supplier_name: { type: ["string", "null"], description: "Seller / supplier name printed on the bill." },
      invoice_number: { type: ["string", "null"], description: "The bill / invoice number, as printed." },
      invoice_date: { type: ["string", "null"], description: "The bill date, as printed." },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            bill_text: { type: "string", description: "The product description exactly as printed." },
            matched_product: {
              type: ["string", "null"],
              description: "The EXACT name from the catalogue list if this line is clearly that product, otherwise null.",
            },
            quantity: { type: "number", description: "Selling units received (pieces/packs) for this line." },
            note: { type: ["string", "null"], description: "Only if a person should double-check this line." },
          },
          required: ["bill_text", "matched_product", "quantity"],
        },
      },
      warnings: { type: "array", items: { type: "string" }, description: "Problems with the bill itself: unreadable parts, cut-off pages, etc." },
    },
    required: ["lines"],
  },
} as const;

function buildPrompt(catalogue: string[]): string {
  return [
    "You are reading a supplier purchase bill for a wholesale distributor so its stock can be inwarded.",
    "Extract every PRODUCT line: what was bought and how many units. Ignore totals, taxes, discounts, freight, round-off and payment lines.",
    "",
    "Rules:",
    "- quantity is the number of selling units (pieces/packs) received. If the bill gives cases/boxes AND states the units per case, multiply and add a note saying so. If it gives only cases and the units per case are not stated, use the number as printed and add a note.",
    "- Free / scheme units on a separate line are real stock: include them as their own line and note that they are free.",
    "- matched_product: choose from the catalogue below ONLY if the bill line is clearly the same product (same brand, variant and pack size). Copy the catalogue name exactly. If you are not sure, use null. Never guess.",
    "- Do not invent lines or quantities. If something is unreadable, leave it out and say so in warnings.",
    "",
    "Product catalogue (one per line):",
    catalogue.length ? catalogue.join("\n") : "(empty)",
  ].join("\n");
}

/**
 * Reads a bill (PDF or photo) with Claude and returns structured lines. Nothing is written to the
 * database here — the caller shows the result to a person to review before anything is posted.
 */
export async function readBill(file: { base64: string; mediaType: string }, catalogue: string[]): Promise<BillReading> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpError(503, "Bill reading isn't set up yet — add ANTHROPIC_API_KEY to the server environment.");
  }
  const isPdf = file.mediaType === "application/pdf";
  const fileBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: file.mediaType, data: file.base64 } }
    : { type: "image", source: { type: "base64", media_type: file.mediaType, data: file.base64 } };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 4096,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: buildPrompt(catalogue) }] }],
    }),
  });
  if (!res.ok) {
    console.error("Bill reading failed", res.status, await res.text().catch(() => ""));
    throw new HttpError(502, "Couldn't read this bill right now. Try again, or enter the lines by hand.");
  }
  const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
  const block = data.content?.find((c) => c.type === "tool_use");
  const input = block?.input as
    | {
        supplier_name?: string | null;
        invoice_number?: string | null;
        invoice_date?: string | null;
        lines?: { bill_text?: string; matched_product?: string | null; quantity?: number; note?: string | null }[];
        warnings?: string[];
      }
    | undefined;
  if (!input || !Array.isArray(input.lines)) {
    throw new HttpError(502, "The bill couldn't be understood. Try a clearer photo or the PDF.");
  }

  const byName = new Map(catalogue.map((n) => [n.trim().toLowerCase(), n]));
  const warnings = [...(input.warnings ?? [])];
  const lines: BillLine[] = [];
  for (const l of input.lines) {
    const billText = (l.bill_text ?? "").trim();
    const qty = Number(l.quantity);
    if (!billText) continue;
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
      warnings.push(`"${billText}": quantity "${l.quantity}" isn't a whole number above zero — skipped, add it by hand if needed.`);
      continue;
    }
    // The reader may only pick names that really exist; anything else is treated as unmatched.
    const matched = l.matched_product ? (byName.get(l.matched_product.trim().toLowerCase()) ?? null) : null;
    lines.push({ billText, productName: matched, quantity: qty, note: l.note?.trim() || undefined });
  }
  return {
    supplierName: input.supplier_name?.trim() || null,
    invoiceNumber: input.invoice_number?.trim() || null,
    invoiceDate: input.invoice_date?.trim() || null,
    lines,
    warnings,
  };
}
