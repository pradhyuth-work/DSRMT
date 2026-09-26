# DSRMT — Billing, Dispatch & Reconciliation

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Prisma 6 + SQLite · Lucide icons.

## Getting started

```bash
npm install      # also runs `prisma generate`
npm run dev      # syncs the SQLite schema, seeds if empty, starts http://localhost:3000
```

`npm run dev` runs `prisma db push` and the seed first. The seed only inserts data into empty tables, so running it again is safe.
To start over with only the seed data, run `npm run db:reset`.

The database file lives at `prisma/dev.db` (see `.env`).

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/sales` | Creates an invoice in one `$transaction`. Returns 400 if stock is short, decrements stock, computes totals and records the initial payment if one was made. |
| `POST` | `/api/payments` | Records a collection for an outlet and applies it to that outlet's oldest open invoices first (FIFO). Writes one `PaymentCollection` row per invoice it settles. |
| `GET` | `/api/reports` | Returns the dashboard totals, each outlet's ledger with a running balance, and staff performance. |
| `GET/POST` | `/api/products` | Lists products or adds one. |
| `POST` | `/api/products/:id/restock` | Adds stock to a product. |
| `GET` | `/api/outlets`, `/api/staff` | Lists outlets and staff for the dropdowns. |

Request bodies are validated with Zod (`lib/validation.ts`). The request and response types in `lib/types.ts` are shared by the routes and the UI.

### Business rules
- Invoice ids are sequential: `INV-1001`, `INV-1002`, …
- Stock is decremented with a conditional update (`stockQty >= qty`), so two sales running at once can't push stock below zero.
- A payment can't be larger than the bill (at sale time) or the outlet's outstanding balance (when collecting later).
- Invoice status is `UNPAID` when nothing has been paid, `PARTIAL` when some has, and `PAID` when the balance is zero.

## Layout

```
app/api/…                 route handlers
app/dashboard/page.tsx    dashboard entry
components/dashboard/     SaleForm, OutletLedgers, StaffPerformance, InventoryManager
lib/                      prisma client, reports, validation, shared types, money helpers
prisma/schema.prisma      data model
prisma/seed.ts            5 products, 3 outlets, 3 staff
```
