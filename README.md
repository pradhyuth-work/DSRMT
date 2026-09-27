# DSRMT — Billing, Dispatch & Reconciliation

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Prisma 6 + Supabase Postgres · Lucide icons.

Role-based login (admin / stock incharge / field agent) sits in front of order billing, dispatch, outlet ledgers and staff reconciliation.

## Roles

| Role | Can do |
| --- | --- |
| **admin** | Everything: manage users, outlets and their field-agent assignment, view/edit/cancel any order, dispatch, manage stock (add, receive, bulk-receive, adjust), collect payments, see reports and ledgers. |
| **stock** (stock incharge) | View all orders and dispatch them, and collect payments. Read-only on products/stock (no receiving, adjusting, or creating products — that's admin-only). Cannot manage users. |
| **agent** (field agent) | Create orders for outlets on their route, and see/cancel only their own **pending** orders. Sees whether a product is in stock, never exact counts. |

There is no public sign-up. An admin creates every account (`Users` tab, or directly via the API), and can disable, re-enable, change the role of, or reset the PIN for anyone but themselves.

## Getting started

1. **Database.** Create a Supabase project (or point at any Postgres 14+). Copy `.env.example` to `.env` and fill in `DATABASE_URL` (pooled, port 6543), `DIRECT_URL` (direct/session, port 5432) and a random `JWT_SECRET`.
2. **Schema.** In the Supabase SQL editor (or `psql`), run the files in `supabase/migrations/` **in order**:
   - `0001_baseline_schema.sql` — creates the original tables. Skip this one if your database already has them.
   - `0002_role_based_auth.sql` — adds `username`/`passwordHash`/`role`/`active` to `Staff`, adds order dispatch fields to `Invoice`, adds the `StockMovement` table, and backfills existing rows (see the comment at the top of the file for exactly what it changes).
   - `0003_outlet_agents_and_product_codes.sql` — adds `Outlet.agentId` and `Product.productCode`. `agentId` is superseded by `0004` below (kept as a historical step — nothing here depends on it once `0004` runs).
   - `0004_outlet_routes.sql` — replaces `0003`'s direct `Outlet.agentId` with an indirect link through routes: adds the `Route` table (one route → at most one field agent, and an agent is tied to at most one route in turn) and `Outlet.routeId`. Every outlet that had an agent gets a same-named route carrying that agent, automatically, before the old column is dropped — no assignment is lost.
   - `0005_outlet_address_gst.sql` — adds `Outlet.address`/`Outlet.gstNumber`.
   - `0006_billing_stage_and_payment_methods.sql` — adds the `PENDING → BILLED → DISPATCHED` order flow (`Invoice.invoiceNumber`/`billedAt`/`billedById`) and the `CHEQUE`/`NET_BANKING` payment methods.
   - `0007_admin_portal_parity.sql` — adds `Outlet.hidden`.
   - `0008_balance_correction_and_supplier_ref.sql` — adds `StockMovement.supplierRef` and the `BalanceAdjustment` table.

   Coming from the old SQLite version of this app? Run `npm run db:import-sqlite` after `0001` (before or after `0002`–`0004`) to copy `prisma/dev.db` across; it refuses to run if the target already has data.
3. **Install and generate the client:**
   ```bash
   npm install
   ```
4. **Create the first admin:**
   ```bash
   # uses ADMIN_USERNAME / ADMIN_PIN (and optional ADMIN_NAME / ADMIN_PHONE) from .env
   npm run seed-admin
   ```
   Existing `Staff` rows are given `role = 'agent'` and no username/PIN by migration `0002`, so they can't log in until an admin sets a username and PIN for them (`Users` tab → **Set up login**).
5. **Run it:**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 and sign in.

Running `npm run seed-admin` again with the same `ADMIN_USERNAME` resets that account's PIN and re-enables/re-admins it — handy if you ever lock yourself out.

## Auth

- Username + PIN (4-8 digits, numeric only). PINs are hashed with **bcryptjs** — same storage as before, just user-facing language and validation changed; the `Staff.passwordHash` column name is unchanged. A successful login returns a **JWT signed with `JWT_SECRET`, valid for 12 hours**, sent by the client as `Authorization: Bearer <token>`.
- `requireAuth` (`lib/auth.ts`) re-reads the user from the database on every request — disabling an account, changing its role, or resetting its PIN takes effect immediately, not just at the next login.
- `requireRole` / `authorize` enforce the table below on the server. **The UI only hides buttons the server would refuse anyway** — every route re-checks.
- Resetting a PIN bumps `tokenVersion`, which invalidates every token issued before the reset.

### Route permission mapping

| Route | admin | stock | agent | Notes |
| --- | :-: | :-: | :-: | --- |
| `POST /api/auth/login` | public | public | public | — |
| `GET /api/auth/me` | ✓ | ✓ | ✓ | any signed-in user |
| `GET/POST /api/staff` | ✓ | ✗ | ✗ | list/create users |
| `PATCH /api/staff/:id` | ✓ | ✗ | ✗ | role/active/details; can't disable or demote self |
| `POST /api/staff/:id/pin` | ✓ | ✗ | ✗ | reset PIN |
| `GET /api/products` | ✓ | ✓ | ✓ | agents get `inStock`, not `stockQty` |
| `POST /api/products` | ✓ | ✗ | ✗ | creates a product (sets opening stock — a stock-inwarding action) |
| `PATCH /api/products/:id` | ✓ | ✗ | ✗ | edit name/price |
| `POST /api/products/:id/restock` | ✓ | ✗ | ✗ | receive stock |
| `POST /api/products/:id/adjust` | ✓ | ✗ | ✗ | up/down correction with a reason; never below zero |
| `POST /api/products/bulk-receive` | ✓ | ✗ | ✗ | bulk stock-inwarding upload (CSV or the in-app grid) |
| `POST /api/products/bulk-rate` | ✓ | ✗ | ✗ | bulk price update (CSV or the in-app grid) — every `productCode` must already exist |
| `PATCH /api/products/:id/code` | ✓ | ✗ | ✗ | explicitly renumbers a product's `#code`; only the products between its old and new position shift |
| `DELETE /api/products/:id` | ✓ | ✗ | ✗ | refused once it's ever been on an order; its warehouse-only movements (opening stock, restocks, adjustments) are cleared along with it |
| `GET /api/stock-movements` | ✓ | ✓ | ✗ | audit trail (read-only for stock); `?productId=&from=&to=` filters, each row carries a derived `direction` (`IN`/`OUT`) and its `supplierRef` |
| `GET /api/outlets` | ✓ (all) | ✓ (all) | ✓ (own route only) | agents only ever see outlets on their route |
| `POST /api/outlets/bulk-create` | ✓ | ✗ | ✗ | add one or many outlets at once (CSV or the in-app grid) — the single-outlet "Add outlet" form posts a one-row batch here too |
| `PATCH /api/outlets/:id` | ✓ | ✗ | ✗ | edit details or move it onto a different route |
| `DELETE /api/outlets/:id` | ✓ | ✗ | ✗ | refused once it has any order history — hide it instead |
| `PATCH /api/outlets/:id/hidden` | ✓ | ✗ | ✗ | soft-hide/unhide from the order-taking pickers; refused while an order is in flight (`PENDING`/`BILLED`) |
| `PATCH /api/outlets/:id/balance` | ✓ | ✗ | ✗ | manual ledger-balance correction (`set` or `adjust`, reason required); refused while an order is in flight |
| `GET /api/outlets/balance-adjustments` | ✓ | ✗ | ✗ | recent balance corrections, newest first |
| `GET /api/outlets/:id/ledger` | ✓ | ✓ | ✗ | one outlet's balance + open invoices, for collecting a payment |
| `GET/POST /api/routes` | ✓ | ✗ | ✗ | list/create routes; creating or updating one with an `agentId` already on another route moves them off it automatically (a route's agent is unique) |
| `PATCH/DELETE /api/routes/:id` | ✓ | ✗ | ✗ | rename / reassign agent; delete refuses while any outlet is still on it |
| `POST /api/sales` | ✓ | ✗ | ✓ | creates a **pending** order for an outlet the caller may use; agents always own the order they create and can only use an outlet on their route |
| `GET /api/orders` | ✓ (all) | ✓ (all) | ✓ (own only) | `?status=` filter |
| `PATCH /api/orders/:id` | ✓ | ✗ | ✗ | edit a pending (not yet billed) order's outlet/items |
| `POST /api/orders/:id/bill` | ✓ | ✓ | ✗ | records the physical bill-book number by hand and moves the order from `PENDING` to `BILLED` |
| `POST /api/orders/:id/dispatch` | ✓ | ✓ | ✗ | requires `BILLED`; locks the order, checks + deducts stock, records a movement |
| `POST /api/orders/:id/cancel` | ✓ (any) | ✗ | ✓ (own, pending only) | dispatched orders return stock; orders with payments can't be cancelled |
| `GET /api/payments` | ✓ (all, filterable) | ✓ (own only) | ✗ | outlet/collector/date filters; stock's `staffId` filter is ignored — always self |
| `POST /api/payments` | ✓ | ✓ | ✗ | FIFO settlement across an outlet's open invoices; stock always attributes the payment to itself |
| `DELETE /api/payments/:id` | ✓ | ✗ | ✗ | reverses the payment — the amount is added back to the invoice's balance and its status recomputed |
| `GET /api/payments/csv` | ✓ | ✓ (own only) | ✗ | same filters and `staffId` scoping as `GET /api/payments`, as a CSV download |
| `GET /api/reports` | ✓ | ✗ | ✗ | dashboard totals (all-time), outlet ledgers (all-time), staff performance (`?from=&to=` filters sales/collections to that date range) |
| `GET /api/reports/sales` | ✓ | ✗ | ✗ | date + outlet filtered sales report: by-product, by-outlet and SKU-matrix breakdowns |
| `GET /api/reports/sales/csv` | ✓ | ✗ | ✗ | the by-product and by-outlet breakdowns for the same filters, as one CSV download |
| `GET /api/backup` | ✓ | ✗ | ✗ | downloads every core table as one JSON file (staff rows exclude passwordHash/tokenVersion) |

## Business logic

- **Order → bill → dispatch flow.** `POST /api/sales` creates the order (invoice) as `PENDING` and prices/validates items, but does **not** assign an invoice number or touch stock. `POST /api/orders/:id/bill` (admin/stock) records the physical bill-book number by hand — it's never auto-generated — and moves the order to `BILLED`. `POST /api/orders/:id/dispatch` runs in one transaction: lock the order, confirm it's `BILLED`, lock the products it needs, refuse with a clear message if any is short, deduct stock, write a `StockMovement`, mark the order `DISPATCHED`.
- **Stock can never go below zero** — enforced both in application code (conditional checks before every decrement) and by a database `CHECK (stockQty >= 0)` constraint as a last line of defence.
- **Cancelling** a dispatched order returns its stock (with a `CANCEL_RETURN` movement). Orders with any payment recorded against them can't be cancelled by anyone. A bill number already assigned stays on a cancelled order rather than being freed for reuse.
- **Payments** apply to an outlet's oldest open invoices first (FIFO). Admin can attribute a collection to any staff member (whoever actually collected it in the field); stock incharge can only ever attribute it to themselves. Payment methods are Cash, Cheque and Net Banking — UPI is kept in the database only so historical payments still display correctly, but is never offered when recording a new one.
- **Outlets belong to a route, routes belong to at most one field agent** (`Outlet.routeId` → `Route.agentId`, both nullable; `Route.agentId` is unique, so an agent is never on more than one route at a time). An agent's outlet dropdown, and every order they create, is restricted to the outlets on their one route; admins aren't restricted. Move an outlet to a different route, or create/rename/reassign routes themselves, from the Outlet Ledgers tab ("Manage routes"), which also has an always-visible search box and a "filter by field agent" dropdown.
- **Products have a sequential `productCode`** (#1, #2, …), shown and sorted on everywhere, separate from the internal id. Creating or bulk-uploading a product with a code that's already taken shifts that product — and everything after it — up by one (`lib/product-codes.ts`), rather than rejecting it.
- **Bulk stock-receive** (`POST /api/products/bulk-receive`, admin only) takes rows of `{ productCode?, name?, unitPrice?, quantity }`, either as an uploaded CSV or the in-app paste/grid editor (both build the same row list client-side). A row whose `productCode` matches an existing product tops it up; otherwise a new product is created. The whole upload is validated first — if any row has a problem, **nothing is written**, and every row's error comes back at once so the batch can be fixed and resubmitted.
- **Invoice numbers are never generated.** An order's internal id is an opaque cuid; the human-facing bill number is whatever gets typed into `POST /api/orders/:id/bill` from the physical bill book, so it can be freeform and match paper exactly. It's `null` until billed and unique once set.
- **Manual ledger corrections** (`PATCH /api/outlets/:id/balance`, admin only) aren't represented as a fake zero-item invoice — an outlet has no single mutable "balance" column to overwrite (it's derived by summing invoice balances), so a correction is instead folded into the outlet's ledger as its own chronological `BalanceAdjustment` entry alongside invoices and payments (`lib/reports.ts`), keeping the running balance always equal to sum(open invoices) + sum(corrections). `mode: "set"` writes an exact target balance; `mode: "adjust"` applies a signed delta on top of the balance at correction time. A reason is mandatory, and it's refused while the outlet has a `PENDING`/`BILLED` order in flight. Collecting a payment still only ever settles real open invoices, oldest first — a correction isn't tied to one to "pay off".
- **Days of credit.** Every open invoice, and each outlet's single oldest one, carries a `daysOutstanding`/`oldestInvoiceDays` figure (`lib/money.ts#daysOutstanding`, measured from the order's `createdAt` — the amount is owed from the moment it's created, not from when it's billed). Shown in Outlet Ledgers, the payment-collection settlement preview, the by-outlet sales report, and as an "Outlets 30+ Days" dashboard stat. The 15/30-day warning/critical thresholds (`DAYS_WARNING_THRESHOLD`/`DAYS_CRITICAL_THRESHOLD` in `lib/money.ts`) are defaults, not a business rule — change them there.
- **Explicit product code change** (`PATCH /api/products/:id/code`, admin only) renumbers an existing product. Unlike creating a product at a taken code (which always shifts everything at/after it up, to make room), moving an existing product only has to close the gap it leaves behind — so only the products strictly between its old and new position shift, by one, in the direction that fills that gap (`lib/product-codes.ts#changeProductCode`).
- All user-provided text (names, reasons, notes) is rendered as plain React text, never `dangerouslySetInnerHTML`, so it's automatically HTML-escaped.

## Layout

```
app/api/…                  route handlers (auth, staff, products [+bulk-receive, +bulk-rate, +:id/code],
                            outlets [+bulk-create, +:id/hidden, +:id/balance, +:id/ledger,
                            +balance-adjustments], routes, orders [+:id/bill, +:id/dispatch, +:id/cancel],
                            sales, payments [+csv], reports [+sales, +sales/csv], stock-movements, backup)
app/dashboard/page.tsx      dashboard entry
components/dashboard/      LoginScreen, SaleForm, AgentOrderForm, OrdersView, OutletLedgers,
                            RoutesManager, PaymentsView, StaffPerformance, SalesReports, InventoryManager,
                            BulkReceiveModal, BulkRateModal, BulkOutletModal, stock-dialogs, UsersManager,
                            payment-form, Combobox, date-range, ui (Modal/StatCard/badges), api-client,
                            session (token storage)
lib/                        prisma client, auth (JWT/bcrypt/requireAuth/requireRole), orders, products,
                            outlets, routes, product-codes, payments, balance-adjustments, staff, reports,
                            validation, shared types, money helpers (incl. daysOutstanding)
prisma/schema.prisma        data model (Postgres)
prisma/seed.ts              legacy SQLite seed (kept for local experimentation; see db:import-sqlite for real data)
supabase/migrations/        SQL to run in the Supabase SQL editor
scripts/seed-admin.ts       creates/resets the admin from ADMIN_USERNAME / ADMIN_PIN
scripts/import-sqlite.ts    one-time copy of old prisma/dev.db data into Postgres
```
