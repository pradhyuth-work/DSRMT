import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/api";

/**
 * Full-database backup and restore.
 *
 * The table list is NOT hand-written: it is read from Prisma's own data model, so every table
 * that exists in prisma/schema.prisma — including any added later (billing, e-invoice, number
 * series, audit log) — is backed up and restored automatically, in the right order for the
 * foreign keys. Nothing is left out, and staff password hashes ARE included so a restore brings
 * the logins back. That makes the file sensitive: it is admin-only and the UI says so.
 */

export const BACKUP_FORMAT = "dsrmt-backup";
export const BACKUP_VERSION = 2;

type Row = Record<string, unknown>;
type Delegate = {
  findMany(args?: unknown): Promise<Row[]>;
  deleteMany(args?: unknown): Promise<unknown>;
  createMany(args: { data: Row[] }): Promise<unknown>;
};
type Tx = Record<string, unknown>;

type ModelMeta = (typeof Prisma.dmmf.datamodel.models)[number];

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function delegateOf(client: Tx, model: string): Delegate {
  const d = client[lcFirst(model)];
  if (!d) throw new Error(`No Prisma delegate for model ${model}`);
  return d as Delegate;
}

/** Models ordered so that a table always comes after the tables its foreign keys point to. */
export function orderedModels(): ModelMeta[] {
  const models = [...Prisma.dmmf.datamodel.models];
  const byName = new Map(models.map((m) => [m.name, m]));
  const deps = new Map<string, Set<string>>();
  for (const m of models) {
    const set = new Set<string>();
    for (const f of m.fields) {
      if (f.kind === "object" && (f.relationFromFields?.length ?? 0) > 0 && f.type !== m.name && byName.has(f.type)) {
        set.add(f.type);
      }
    }
    deps.set(m.name, set);
  }
  const out: ModelMeta[] = [];
  const done = new Set<string>();
  while (out.length < models.length) {
    const ready = models.filter((m) => !done.has(m.name) && [...(deps.get(m.name) ?? [])].every((d) => done.has(d)));
    if (ready.length === 0) throw new Error("Circular table dependency; backup order cannot be worked out");
    for (const m of ready) {
      out.push(m);
      done.add(m.name);
    }
  }
  return out;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  generatedAt: string;
  rowCounts: Record<string, number>;
  tables: Record<string, Row[]>;
}

/** Reads every table inside one transaction so the file is a consistent snapshot. */
export async function buildBackup(): Promise<BackupFile> {
  const models = orderedModels();
  const tables: Record<string, Row[]> = {};
  await prisma.$transaction(
    async (tx) => {
      for (const m of models) {
        tables[m.name] = await delegateOf(tx as unknown as Tx, m.name).findMany();
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000, maxWait: 10_000 },
  );
  const rowCounts = Object.fromEntries(models.map((m) => [m.name, tables[m.name].length]));
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, generatedAt: new Date().toISOString(), rowCounts, tables };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Checks a parsed file is a complete, untampered, current-format backup. Returns it typed. */
export function validateBackup(input: unknown): BackupFile {
  if (!isObject(input) || input.format !== BACKUP_FORMAT) throw new HttpError(400, "This is not a DSRMT backup file");
  if (input.version !== BACKUP_VERSION) {
    throw new HttpError(
      400,
      "This is an older, partial backup (it does not hold every table) and cannot be used for a full restore. Use a backup made after this update.",
    );
  }
  if (!isObject(input.tables) || !isObject(input.rowCounts)) throw new HttpError(400, "Backup file is damaged: tables are missing");
  const known = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));
  for (const name of Object.keys(input.tables)) {
    if (!known.has(name)) throw new HttpError(400, `Backup holds a table this app does not know (${name}). Restore it with the version that made it.`);
  }
  for (const [name, rows] of Object.entries(input.tables)) {
    if (!Array.isArray(rows)) throw new HttpError(400, `Backup file is damaged: ${name} is not a list`);
    if (input.rowCounts[name] !== rows.length) {
      throw new HttpError(400, `Backup file is incomplete: ${name} should have ${String(input.rowCounts[name])} rows but has ${rows.length}`);
    }
  }
  return input as unknown as BackupFile;
}

/** JSON turns dates into strings; put real Date objects back so the database accepts them. */
function reviveRow(m: ModelMeta, row: Row): Row {
  const out: Row = { ...row };
  for (const f of m.fields) {
    if (f.kind === "scalar" && f.type === "DateTime" && typeof out[f.name] === "string") {
      out[f.name] = new Date(out[f.name] as string);
    }
  }
  return out;
}

export interface RestoreResult {
  restoredRows: Record<string, number>;
  /** Tables that exist in this app but not in the backup file (made before they existed). They are left empty. */
  emptied: string[];
}

const CHUNK = 500;

/** Replaces the whole database with the backup, all-or-nothing. */
export async function restoreBackup(file: BackupFile): Promise<RestoreResult> {
  const models = orderedModels();
  const restoredRows: Record<string, number> = {};
  const emptied = models.filter((m) => !(m.name in file.tables)).map((m) => m.name);

  await prisma.$transaction(
    async (tx) => {
      const client = tx as unknown as Tx;
      for (const m of [...models].reverse()) await delegateOf(client, m.name).deleteMany();
      for (const m of models) {
        const rows = (file.tables[m.name] ?? []).map((r) => reviveRow(m, r));
        for (let i = 0; i < rows.length; i += CHUNK) {
          await delegateOf(client, m.name).createMany({ data: rows.slice(i, i + CHUNK) });
        }
        restoredRows[m.name] = rows.length;
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { restoredRows, emptied };
}
