import type { Prisma } from "@prisma/client";

const AUDIT_KEY = "invoice_audit";

export interface InvoiceAuditEntry {
  at: string;
  by: string;
  invoiceNumber: string;
  orderId: string;
  action: "CANCEL" | "RETURN_TO_PENDING";
  reason: string;
  numberReused: boolean;
}

/** Appends who reversed which invoice, when and why. Kept in AppSetting so it is part of the full backup. */
export async function appendInvoiceAudit(tx: Prisma.TransactionClient, entry: InvoiceAuditEntry): Promise<void> {
  const row = await tx.appSetting.findUnique({ where: { key: AUDIT_KEY } });
  let list: InvoiceAuditEntry[] = [];
  try {
    const parsed: unknown = JSON.parse(row?.value ?? "[]");
    if (Array.isArray(parsed)) list = parsed as InvoiceAuditEntry[];
  } catch {
    list = [];
  }
  list.push(entry);
  const value = JSON.stringify(list.slice(-2000));
  await tx.appSetting.upsert({ where: { key: AUDIT_KEY }, update: { value }, create: { key: AUDIT_KEY, value } });
}
