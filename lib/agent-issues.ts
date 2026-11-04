import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { HttpError } from "./api";
import { daysOutstanding, round2 } from "./money";
import type {
  AgentBalanceDTO,
  AgentHoldingDTO,
  AgentIssueDTO,
  AgentLedgerEntryDTO,
  AuthUser,
  CreateAgentIssueInput,
  SettleAgentInput,
  SettleAgentResponse,
} from "./types";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

/**
 * Agent Issue: stock handed to a field agent without billing any outlet. Targets are tracked
 * outside the app, so nothing here looks at them — admin or stock incharge simply records what
 * was given. Each line is priced at the product's billing rate (unitPrice, tax already inside),
 * frozen at the moment of issue, and the total is what the agent owes until the units are
 * settled. It is not a tax invoice, so there is no tax line and no bill-book number.
 */

const issueInclude = {
  agent: { select: { name: true } },
  createdBy: { select: { name: true } },
  items: { include: { product: { select: { name: true } } }, orderBy: { id: "asc" as const } },
} satisfies Prisma.AgentIssueInclude;

type IssueRow = Prisma.AgentIssueGetPayload<{ include: typeof issueInclude }>;

export function toAgentIssueDTO(i: IssueRow): AgentIssueDTO {
  return {
    id: i.id,
    number: i.number,
    agentId: i.agentId,
    agentName: i.agent.name,
    note: i.note,
    totalAmount: i.totalAmount,
    createdByName: i.createdBy.name,
    createdAt: i.createdAt.toISOString(),
    items: i.items.map((it) => ({
      productId: it.productId,
      productName: it.product.name,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      subtotal: it.subtotal,
    })),
  };
}

/** AI-YYMM-001 style prefix, using Indian time so the month matches the business's calendar. */
export function issuePrefix(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const yy = String(ist.getUTCFullYear()).slice(2);
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `AI-${yy}${mm}-`;
}

async function requireAgent(tx: Tx, agentId: string, mustBeActive: boolean) {
  const agent = await tx.staff.findUnique({ where: { id: agentId }, select: { id: true, name: true, role: true, active: true } });
  if (!agent || agent.role !== "agent") throw new HttpError(400, "Pick a field agent");
  if (mustBeActive && !agent.active) throw new HttpError(400, `${agent.name}'s account is disabled`);
  return agent;
}

/**
 * Records an issue: locks the products, refuses if any is short, deducts stock, writes one
 * AGENT_ISSUE stock movement per product and the issue itself, all in one transaction.
 */
export async function createAgentIssue(tx: Tx, user: AuthUser, input: CreateAgentIssueInput): Promise<AgentIssueDTO> {
  const agent = await requireAgent(tx, input.agentId, true);

  const needed = new Map<string, number>();
  for (const line of input.items) needed.set(line.productId, (needed.get(line.productId) ?? 0) + line.quantity);
  const productIds = [...needed.keys()].sort();

  // Lock in a consistent order so two issues (or bills) sharing products can't deadlock.
  const products = await tx.$queryRaw<{ id: string; name: string; stockQty: number; unitPrice: number }[]>`
    SELECT "id", "name", "stockQty", "unitPrice" FROM "Product"
    WHERE "id" IN (${Prisma.join(productIds)})
    ORDER BY "id"
    FOR UPDATE`;
  if (products.length !== productIds.length) throw new HttpError(400, "One of the products no longer exists");

  const shortages = products
    .filter((p) => p.stockQty < needed.get(p.id)!)
    .map((p) => `${p.name} (need ${needed.get(p.id)}, have ${p.stockQty})`);
  if (shortages.length > 0) throw new HttpError(400, `Not enough stock for ${shortages.join(", ")}`);

  // One issue number at a time, so two people saving together can't both take the same one.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('agent_issue_number'))`;
  const prefix = issuePrefix();
  const used = await tx.agentIssue.count({ where: { number: { startsWith: prefix } } });
  const number = `${prefix}${String(used + 1).padStart(3, "0")}`;

  const lines = products.map((p) => {
    const quantity = needed.get(p.id)!;
    return { productId: p.id, quantity, unitPrice: p.unitPrice, subtotal: round2(quantity * p.unitPrice) };
  });
  const totalAmount = round2(lines.reduce((s, l) => s + l.subtotal, 0));

  const issue = await tx.agentIssue.create({
    data: {
      number,
      agentId: agent.id,
      note: input.note || null,
      totalAmount,
      createdById: user.id,
      items: { create: lines },
    },
    include: issueInclude,
  });

  const stockRows = productIds.map((productId) => Prisma.sql`(${productId}::text, ${needed.get(productId)!}::int)`);
  await tx.$executeRaw`
    UPDATE "Product" AS p
    SET "stockQty" = p."stockQty" - v.qty
    FROM (VALUES ${Prisma.join(stockRows)}) AS v(id, qty)
    WHERE p."id" = v.id`;
  await tx.stockMovement.createMany({
    data: productIds.map((productId) => ({
      productId,
      change: -needed.get(productId)!,
      type: "AGENT_ISSUE" as const,
      reason: `Issued to ${agent.name} (${number})`,
      staffId: user.id,
    })),
  });

  return toAgentIssueDTO(issue);
}

export async function listAgentIssues(db: Db, agentId?: string, limit = 100): Promise<AgentIssueDTO[]> {
  const rows = await db.agentIssue.findMany({
    where: agentId ? { agentId } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    include: issueInclude,
  });
  return rows.map(toAgentIssueDTO);
}

interface OpenRow {
  agentId: string;
  productId: string;
  quantity: number;
  value: number;
  oldest: Date;
}

/**
 * Every active field agent, plus any agent who still owes something, with what they hold.
 * Pass `onlyAgentId` to scope it to one agent (what a field agent sees of themselves).
 */
export async function getAgentBalances(db: Db, onlyAgentId?: string): Promise<AgentBalanceDTO[]> {
  const scope = onlyAgentId ? Prisma.sql`AND a."agentId" = ${onlyAgentId}` : Prisma.empty;
  const open = await db.$queryRaw<OpenRow[]>`
    SELECT a."agentId" AS "agentId", i."productId" AS "productId",
           SUM(i."quantity" - i."settledQty")::int AS "quantity",
           SUM((i."quantity" - i."settledQty") * i."unitPrice")::double precision AS "value",
           MIN(a."createdAt") AS "oldest"
    FROM "AgentIssueItem" i
    JOIN "AgentIssue" a ON a."id" = i."issueId"
    WHERE i."settledQty" < i."quantity" ${scope}
    GROUP BY a."agentId", i."productId"`;

  const [agents, products] = await Promise.all([
    db.staff.findMany({
      where: { role: "agent", ...(onlyAgentId ? { id: onlyAgentId } : {}) },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({ select: { id: true, name: true } }),
  ]);
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const now = new Date();

  const byAgent = new Map<string, OpenRow[]>();
  for (const row of open) byAgent.set(row.agentId, [...(byAgent.get(row.agentId) ?? []), row]);

  return agents
    .map((a): AgentBalanceDTO => {
      const rows = byAgent.get(a.id) ?? [];
      const holdings: AgentHoldingDTO[] = rows
        .map((r) => ({
          productId: r.productId,
          productName: productName.get(r.productId) ?? r.productId,
          quantity: r.quantity,
          value: round2(r.value),
          oldestDays: daysOutstanding(new Date(r.oldest), now),
        }))
        .sort((x, y) => x.productName.localeCompare(y.productName));
      return {
        agentId: a.id,
        agentName: a.name,
        active: a.active,
        balance: round2(holdings.reduce((s, h) => s + h.value, 0)),
        unitsInHand: holdings.reduce((s, h) => s + h.quantity, 0),
        oldestDays: holdings.length ? Math.max(...holdings.map((h) => h.oldestDays)) : null,
        holdings,
      };
    })
    .filter((b) => b.active || b.balance > 0);
}

/**
 * Clears units from an agent's holding, oldest issue first, at the rate each was issued at.
 * PAID = cash received; WRITE_OFF = admin only, nobody charged. Refused if the agent holds
 * fewer units of the product than asked. Units never go back to stock.
 */
export async function settleAgent(tx: Tx, user: AuthUser, agentId: string, input: SettleAgentInput): Promise<SettleAgentResponse> {
  // Serialises everything that settles this agent, so two clicks can't clear the same units.
  await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${agentId} FOR UPDATE`;
  const agent = await requireAgent(tx, agentId, false);

  const product = await tx.product.findUnique({ where: { id: input.productId }, select: { id: true, name: true } });
  if (!product) throw new HttpError(404, "Product not found");

  const lots = await tx.$queryRaw<{ id: string; quantity: number; settledQty: number; unitPrice: number }[]>`
    SELECT i."id", i."quantity", i."settledQty", i."unitPrice"
    FROM "AgentIssueItem" i
    JOIN "AgentIssue" a ON a."id" = i."issueId"
    WHERE a."agentId" = ${agentId} AND i."productId" = ${input.productId} AND i."settledQty" < i."quantity"
    ORDER BY a."createdAt" ASC, i."id" ASC
    FOR UPDATE OF i`;
  const held = lots.reduce((s, l) => s + (l.quantity - l.settledQty), 0);
  if (input.quantity > held) {
    throw new HttpError(400, `${agent.name} holds only ${held} of ${product.name}`);
  }

  let left = input.quantity;
  let amount = 0;
  for (const lot of lots) {
    if (left === 0) break;
    const take = Math.min(left, lot.quantity - lot.settledQty);
    await tx.$executeRaw`UPDATE "AgentIssueItem" SET "settledQty" = "settledQty" + ${take} WHERE "id" = ${lot.id}`;
    amount += take * lot.unitPrice;
    left -= take;
  }
  amount = round2(amount);

  await tx.agentSettlement.create({
    data: {
      agentId,
      productId: input.productId,
      quantity: input.quantity,
      amount,
      type: input.method,
      reason: input.reason || null,
      createdById: user.id,
    },
  });

  const [after] = await getAgentBalances(tx, agentId);
  return { amount, balance: after?.balance ?? 0 };
}

/** Oldest first, with a running balance. Issues come before settlements recorded at the same instant. */
export async function getAgentLedger(db: Db, agentId: string, limit = 300): Promise<AgentLedgerEntryDTO[]> {
  const [issues, settlements] = await Promise.all([
    db.agentIssue.findMany({
      where: { agentId },
      include: { items: { include: { product: { select: { name: true } } }, orderBy: { id: "asc" } } },
    }),
    db.agentSettlement.findMany({ where: { agentId }, include: { product: { select: { name: true } } } }),
  ]);

  type Raw = Omit<AgentLedgerEntryDTO, "balance"> & { at: number; order: number };
  const raw: Raw[] = [];
  for (const issue of issues) {
    for (const it of issue.items) {
      raw.push({
        id: it.id,
        date: issue.createdAt.toISOString(),
        at: issue.createdAt.getTime(),
        order: 0,
        type: "ISSUE",
        ref: issue.number,
        productName: it.product.name,
        quantity: it.quantity,
        debit: it.subtotal,
        credit: 0,
        note: issue.note,
      });
    }
  }
  for (const s of settlements) {
    raw.push({
      id: s.id,
      date: s.createdAt.toISOString(),
      at: s.createdAt.getTime(),
      order: 1,
      type: s.type,
      ref: null,
      productName: s.product.name,
      quantity: s.quantity,
      debit: 0,
      credit: s.amount,
      note: s.reason,
    });
  }
  raw.sort((a, b) => a.at - b.at || a.order - b.order || a.id.localeCompare(b.id));

  let running = 0;
  const entries = raw.map(({ at: _at, order: _order, ...e }): AgentLedgerEntryDTO => {
    running = round2(running + e.debit - e.credit);
    return { ...e, balance: running };
  });
  return entries.slice(-limit);
}
