// One-time copy of the old SQLite data (prisma/dev.db) into the Postgres database in DATABASE_URL.
// Usage: npm run db:import-sqlite [-- path/to/dev.db]
//
// Run after supabase/migrations/0001 (0002 may be applied before or after). It refuses to run
// if the target already has any products, outlets, staff or invoices, so it can't duplicate data.
// Everything is inserted in one transaction. Imported invoices are marked DISPATCHED because
// the old app deducted their stock when they were created.
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: rely on the environment
}

const sqlitePath = process.argv[2] ?? "prisma/dev.db";
const prisma = new PrismaClient();

type Row = Record<string, string | number | null>;

// Prisma stored SQLite DateTimes as epoch milliseconds (or ISO text in older versions).
function toDate(value: string | number | null): Date {
  if (value === null) throw new Error("Unexpected NULL timestamp");
  return new Date(typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : value);
}

async function main() {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const all = (table: string) => db.prepare(`SELECT * FROM "${table}"`).all() as Row[];
  const data = {
    products: all("Product"),
    outlets: all("Outlet"),
    staff: all("Staff"),
    invoices: all("Invoice"),
    items: all("InvoiceItem"),
    payments: all("PaymentCollection"),
  };
  db.close();

  const counts = await Promise.all([
    prisma.product.count(),
    prisma.outlet.count(),
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "Staff"`.then((r) => Number(r[0].n)),
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "Invoice"`.then((r) => Number(r[0].n)),
  ]);
  if (counts.some((n) => n > 0)) {
    throw new Error("Target database already has data; refusing to import (nothing was changed).");
  }

  const hasFulfilment = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'Invoice' AND column_name = 'fulfilmentStatus') AS "exists"`;

  // Raw inserts touch only the original columns, so this works before or after migration 0002.
  await prisma.$transaction(
    async (tx) => {
      for (const p of data.products) {
        await tx.$executeRaw`INSERT INTO "Product" ("id","name","unitPrice","stockQty","createdAt")
          VALUES (${p.id}, ${p.name}, ${Number(p.unitPrice)}, ${Number(p.stockQty)}, ${toDate(p.createdAt)})`;
      }
      for (const o of data.outlets) {
        await tx.$executeRaw`INSERT INTO "Outlet" ("id","name","phone","createdAt")
          VALUES (${o.id}, ${o.name}, ${o.phone}, ${toDate(o.createdAt)})`;
      }
      for (const s of data.staff) {
        await tx.$executeRaw`INSERT INTO "Staff" ("id","name","phone","createdAt")
          VALUES (${s.id}, ${s.name}, ${s.phone}, ${toDate(s.createdAt)})`;
      }
      for (const i of data.invoices) {
        await tx.$executeRaw`INSERT INTO "Invoice" ("id","outletId","staffId","totalAmount","paidAmount","balanceDue","status","createdAt")
          VALUES (${i.id}, ${i.outletId}, ${i.staffId}, ${Number(i.totalAmount)}, ${Number(i.paidAmount)},
                  ${Number(i.balanceDue)}, ${i.status}::"InvoiceStatus", ${toDate(i.createdAt)})`;
      }
      for (const it of data.items) {
        await tx.$executeRaw`INSERT INTO "InvoiceItem" ("id","invoiceId","productId","quantity","unitPrice","subtotal")
          VALUES (${it.id}, ${it.invoiceId}, ${it.productId}, ${Number(it.quantity)}, ${Number(it.unitPrice)}, ${Number(it.subtotal)})`;
      }
      for (const pc of data.payments) {
        await tx.$executeRaw`INSERT INTO "PaymentCollection" ("id","outletId","staffId","invoiceId","amount","paymentMethod","notes","createdAt")
          VALUES (${pc.id}, ${pc.outletId}, ${pc.staffId}, ${pc.invoiceId}, ${Number(pc.amount)},
                  ${pc.paymentMethod}::"PaymentMethod", ${pc.notes}, ${toDate(pc.createdAt)})`;
      }
      if (hasFulfilment[0]?.exists) {
        await tx.$executeRaw`UPDATE "Invoice" SET "fulfilmentStatus" = 'DISPATCHED', "dispatchedAt" = "createdAt"`;
      }
    },
    { timeout: 60_000 },
  );

  console.log(
    `Imported ${data.products.length} products, ${data.outlets.length} outlets, ${data.staff.length} staff, ` +
      `${data.invoices.length} invoices, ${data.items.length} items, ${data.payments.length} payments.`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
