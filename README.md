# DSRMT — Billing, Dispatch & Reconciliation

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Prisma 6 + Supabase Postgres · Lucide icons.

Role-based login (admin / stock incharge / field agent) sits in front of order billing, dispatch, outlet ledgers and staff reconciliation.

## Roles

| Role | Can do |
| --- | --- |
| **admin** | Everything: manage users, view/edit/cancel any order, dispatch, manage stock, see reports and ledgers. |
| **stock** (stock incharge) | Manage products and stock (receive, adjust with a reason), view all orders, dispatch orders. Cannot manage users, see reports, or record payments. |
| **agent** (field agent) | Create orders and see/cancel only their own **pending** orders. Sees whether a product is in stock, never exact counts. |

There is no public sign-up. An admin creates every account (`Users` tab, or directly via the API), and can disable, re-enable, change the role of, or reset the password for anyone but themselves.

## Getting started

1. **Database.** Create a Supabase project (or point at any Postgres 14+). Copy `.env.example` to `.env` and fill in `DATABASE_URL` (pooled, port 6543), `DIRECT_URL` (direct/session, port 5432) and a random `JWT_SECRET`.
2. **Schema.** In the Supabase SQL editor (or `psql`), run the two files in `supabase/migrations/` **in order**:
   - `0001_baseline_schema.sql` — creates the original tables. Skip this one if your database already has them.
   - `0002_role_based_auth.sql` — adds `username`/`passwordHash`/`role`/`active` to `Staff`, adds order dispatch fields to `Invoice`, adds the `StockMovement` table, and backfills existing rows (see the comment at the top of the file for exactly what it changes).

   Coming from the old SQLite version of this app? Run `npm run db:import-sqlite` after `0001` (before or after `0002`) to copy `prisma/dev.db` across; it refuses to run if the target already has data.
3. **Install and generate the client:**
   ```bash
   npm install
   ```
4. **Create the first admin:**
   ```bash
   # uses ADMIN_USERNAME / ADMIN_PASSWORD (and optional ADMIN_NAME / ADMIN_PHONE) from .env
   npm run seed-admin
   ```
   Existing `Staff` rows are given `role = 'agent'` and no username/password by migration `0002`, so they can't log in until an admin sets a username and password for them (`Users` tab → **Set up login**).
5. **Run it:**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 and sign in.

Running `npm run seed-admin` again with the same `ADMIN_USERNAME` resets that account's password and re-enables/re-admins it — handy if you ever lock yourself out.

## Auth

- Username + password. Passwords are hashed with **bcryptjs**. A successful login returns a **JWT signed with `JWT_SECRET`, valid for 12 hours**, sent by the client as `Authorization: Bearer <token>`.
- `requireAuth` (`lib/auth.ts`) re-reads the user from the database on every request — disabling an account, changing its role, or resetting its password takes effect immediately, not just at the next login.
- `requireRole` / `authorize` enforce the table below on the server. **The UI only hides buttons the server would refuse anyway** — every route re-checks.
- Resetting a password bumps `tokenVersion`, which invalidates every token issued before the reset.

### Route permission mapping

| Route | admin | stock | agent | Notes |
| --- | :-: | :-: | :-: | --- |
| `POST /api/auth/login` | public | public | public | — |
| `GET /api/auth/me` | ✓ | ✓ | ✓ | any signed-in user |
| `GET/POST /api/staff` | ✓ | ✗ | ✗ | list/create users |
| `PATCH /api/staff/:id` | ✓ | ✗ | ✗ | role/active/details; can't disable or demote self |
| `POST /api/staff/:id/password` | ✓ | ✗ | ✗ | reset password |
| `GET/POST /api/products` | ✓ | ✓ | ✓ (GET only) | agents can't create products; agents get `inStock`, not `stockQty` |
| `PATCH /api/products/:id` | ✓ | ✓ | ✗ | edit name/price |
| `POST /api/products/:id/restock` | ✓ | ✓ | ✗ | receive stock |
| `POST /api/products/:id/adjust` | ✓ | ✓ | ✗ | up/down correction with a reason; never below zero |
| `GET /api/stock-movements` | ✓ | ✓ | ✗ | audit trail |
| `GET /api/outlets` | ✓ | ✓ | ✓ | — |
| `POST /api/sales` | ✓ | ✗ | ✓ | creates a **pending** order; agents always own the order they create |
| `GET /api/orders` | ✓ (all) | ✓ (all) | ✓ (own only) | `?status=` filter |
| `PATCH /api/orders/:id` | ✓ | ✗ | ✗ | edit a pending order's outlet/items |
| `POST /api/orders/:id/dispatch` | ✓ | ✓ | ✗ | locks the order, checks + deducts stock, records a movement |
| `POST /api/orders/:id/cancel` | ✓ (any) | ✗ | ✓ (own, pending only) | dispatched orders return stock; orders with payments can't be cancelled |
| `POST /api/payments` | ✓ | ✗ | ✗ | FIFO settlement across an outlet's open invoices |
| `GET /api/reports` | ✓ | ✗ | ✗ | dashboard totals, ledgers, staff performance |

## Business logic

- **Order → dispatch flow.** `POST /api/sales` creates the order (invoice) as `PENDING` and prices/validates items, but does **not** touch stock. `POST /api/orders/:id/dispatch` runs in one transaction: lock the order, confirm it's still `PENDING`, lock the products it needs, refuse with a clear message if any is short, deduct stock, write a `StockMovement`, mark the order `DISPATCHED`.
- **Stock can never go below zero** — enforced both in application code (conditional checks before every decrement) and by a database `CHECK (stockQty >= 0)` constraint as a last line of defence.
- **Cancelling** a dispatched order returns its stock (with a `CANCEL_RETURN` movement). Orders with any payment recorded against them can't be cancelled by anyone.
- **Payments** (`POST /api/payments`) apply to an outlet's oldest open invoices first (FIFO), same as before this change.
- Invoice ids remain sequential: `INV-1001`, `INV-1002`, …
- All user-provided text (names, reasons, notes) is rendered as plain React text, never `dangerouslySetInnerHTML`, so it's automatically HTML-escaped.

## Layout

```
app/api/…                 route handlers (auth, staff, products, orders, sales, payments, reports, stock-movements)
app/dashboard/page.tsx     dashboard entry
components/dashboard/      LoginScreen, SaleForm, OrdersView, OutletLedgers, StaffPerformance,
                            InventoryManager, UsersManager, api-client, session (token storage)
lib/                        prisma client, auth (JWT/bcrypt/requireAuth/requireRole), orders, products,
                            staff, reports, validation, shared types, money helpers
prisma/schema.prisma        data model (Postgres)
prisma/seed.ts              legacy SQLite seed (kept for local experimentation; see db:import-sqlite for real data)
supabase/migrations/        SQL to run in the Supabase SQL editor
scripts/seed-admin.ts       creates/resets the admin from ADMIN_USERNAME / ADMIN_PASSWORD
scripts/import-sqlite.ts    one-time copy of old prisma/dev.db data into Postgres
```
