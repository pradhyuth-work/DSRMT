// Pure helpers for reading gstinapi.in replies. No imports, so scripts/test-einvoice-live.ts can run them directly.

export type GspReply =
  /** The service said yes. */
  | { kind: "ok"; data: Record<string, unknown> }
  /** The service said no: nothing was registered. */
  | { kind: "rejected"; message: string }
  /** No clear answer: it may or may not have been registered. */
  | { kind: "unknown"; message: string };

/** HTTP statuses the service documents as refusals. 502 and other 5xx are deliberately not here. */
const REFUSALS = new Set([400, 401, 402, 403, 404, 422, 429]);

const REFUSAL_TEXT: Record<number, string> = {
  401: "The GSP refused the API key",
  402: "Not enough GSP credits",
  403: "The GSP account is deactivated",
  429: "Too many requests to the GSP: wait a minute and try again",
};

export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export function readReply(status: number, body: unknown): GspReply {
  const data = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (status >= 200 && status < 300 && data?.success === true) return { kind: "ok", data };
  const said = str(data?.error) ?? str(data?.message);
  const code = str(data?.error_code);
  const detail = said ? `${said}${code ? ` (code ${code})` : ""}` : null;
  if (REFUSALS.has(status) || (status >= 200 && status < 300 && data?.success === false)) {
    return { kind: "rejected", message: detail ?? REFUSAL_TEXT[status] ?? `The GSP refused the request (${status})` };
  }
  return { kind: "unknown", message: detail ?? `No clear reply from the GSP (${status})` };
}

export interface SentDoc {
  buyerGstin: string;
  total: number;
  /** dd/MM/yyyy */
  date: string;
}

/**
 * When the portal says the number was already registered, checks that the registered invoice is this bill
 * (the same number may have been used in other billing software). Returns why it differs, or null when it
 * matches or the signed invoice can't be read.
 */
export function signedInvoiceMismatch(signed: string | null, sent: SentDoc): string | null {
  const part = signed?.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { data?: unknown };
    const doc = (typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data ?? payload) as {
      BuyerDtls?: { Gstin?: string };
      ValDtls?: { TotInvVal?: number };
      DocDtls?: { Dt?: string };
    };
    const diffs: string[] = [];
    const gstin = doc.BuyerDtls?.Gstin;
    const total = doc.ValDtls?.TotInvVal;
    const date = doc.DocDtls?.Dt;
    if (gstin && gstin !== sent.buyerGstin) diffs.push(`buyer ${gstin}`);
    if (typeof total === "number" && Math.abs(total - sent.total) > 1) diffs.push(`amount ${total}`);
    if (date && date !== sent.date) diffs.push(`date ${date}`);
    return diffs.length ? diffs.join(", ") : null;
  } catch {
    return null;
  }
}
