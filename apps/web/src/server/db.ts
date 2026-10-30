import { MIGRATIONS } from "./migrations";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** The few things the server needs from Postgres. Implemented by node-postgres and PGlite. */
export interface Db extends Queryable {
  /** Runs fn on one connection inside BEGIN/COMMIT; rolls back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const INT8_OID = 20;

/**
 * postgres://… → node-postgres pool (production, Docker Compose).
 * pglite://<dir> or unset → embedded PGlite on disk (dev without Docker).
 * pglite://memory → in-memory PGlite (tests).
 */
export async function openDb(url: string | undefined): Promise<Db> {
  const db = url?.startsWith("postgres") ? await openPg(url) : await openPglite(url ?? "pglite://.data/pglite");
  await migrate(db);
  return db;
}

async function openPg(url: string): Promise<Db> {
  const pg = (await import("pg")).default;
  // BIGINT columns hold millisecond timestamps, well inside Number's safe range.
  const types = {
    getTypeParser: ((oid: number, format?: "text") =>
      oid === INT8_OID ? Number : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
  };
  const pool = new pg.Pool({ connectionString: url, types });
  return {
    query: async <T,>(sql: string, params?: unknown[]) => (await pool.query(sql, params)).rows as T[],
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async <T,>(sql: string, params?: unknown[]) => (await client.query(sql, params)).rows as T[],
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(url: string): Promise<Db> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const dir = url.replace(/^pglite:\/\//, "");
  // PGlite creates the database folder but not its parents (a fresh install has no .data/).
  if (dir !== "memory") (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir === "memory" ? undefined : dir, { parsers: { [types.INT8]: Number } });
  return {
    query: async <T,>(sql: string, params?: unknown[]) => (await pg.query<T>(sql, params)).rows,
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: async <T,>(sql: string, params?: unknown[]) => (await tx.query<T>(sql, params)).rows })),
    close: () => pg.close(),
  };
}

// The web server and workers can start at the same time. Every migration step takes this
// advisory lock, so they migrate one after another; whoever comes second sees the work done.
// (Even CREATE TABLE IF NOT EXISTS isn't safe when two sessions run it concurrently.)
const MIGRATION_LOCK = 7472736; // arbitrary key: "migrations"

/** Applies pending migrations. Safe to call again (and from several processes at once). */
export async function migrate(db: Db) {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await tx.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  });
  for (const [i, sql] of MIGRATIONS.entries()) {
    const version = i + 1;
    await db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
      const [done] = await tx.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
      if (done) return;
      for (const statement of sql.split(/;\s*$/m).filter((s) => s.trim())) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    });
  }
}
