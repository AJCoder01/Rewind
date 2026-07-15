import type { Pool } from "pg";
import { migrationChecksum, assertMigrationLedgerShape } from "@/lib/db/migrate";
import type { DatabaseQuery } from "@/lib/db/catalog";
import {
  FOUNDATION_MIGRATION_ID,
  OAUTH_CONSTRAINTS,
  OAUTH_MIGRATION_CHECKSUM,
  OAUTH_MIGRATION_ID,
  OAUTH_TABLES,
  OAUTH_COLUMN_SIGNATURES,
} from "@/lib/db/schema";

const migrationLockName = "rewind:schema-migrations";
const createLedgerSql = `
  CREATE TABLE IF NOT EXISTS rewind_schema_migrations (
    migration_id text,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rewind_schema_migrations_pkey PRIMARY KEY (migration_id),
    CONSTRAINT rewind_schema_migrations_checksum_check CHECK (checksum ~ '^sha256:[a-f0-9]{64}$')
  )
`;

export async function applyOAuthMigration(pool: Pool, sql: string): Promise<"applied" | "already_applied"> {
  const checksum = migrationChecksum(sql);
  if (checksum !== OAUTH_MIGRATION_CHECKSUM) {
    throw new Error("Migration checksum does not match the reviewed OAuth migration; no database connection was attempted.");
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SET LOCAL search_path TO public, pg_catalog");
    await client.query("SET LOCAL lock_timeout TO '5s'");
    await client.query("SET LOCAL statement_timeout TO '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [migrationLockName]);
    await client.query(createLedgerSql);
    await assertMigrationLedgerShape(client);

    const foundation = await client.query<{ checksum: string }>(
      "SELECT checksum FROM rewind_schema_migrations WHERE migration_id = $1",
      [FOUNDATION_MIGRATION_ID],
    );
    if (!foundation.rowCount) {
      throw new Error("The foundation migration must be applied before the OAuth migration.");
    }

    const existing = await client.query<{ checksum: string }>(
      "SELECT checksum FROM rewind_schema_migrations WHERE migration_id = $1",
      [OAUTH_MIGRATION_ID],
    );
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== OAUTH_MIGRATION_CHECKSUM) {
        throw new Error("The applied OAuth migration checksum differs from the reviewed migration; refusing to continue.");
      }
      await assertOAuthCatalog((text, values) => client.query(text, values ? [...values] : undefined));
      await client.query("COMMIT");
      transactionStarted = false;
      return "already_applied";
    }

    await client.query(sql);
    await assertOAuthCatalog((text, values) => client.query(text, values ? [...values] : undefined));
    await client.query(
      "INSERT INTO rewind_schema_migrations (migration_id, checksum) VALUES ($1, $2)",
      [OAUTH_MIGRATION_ID, checksum],
    );
    await client.query("COMMIT");
    transactionStarted = false;
    return "applied";
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function assertOAuthCatalog(client: DatabaseQuery): Promise<void> {
  const columns = await client<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
    column_default: string | null;
  }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`,
    [OAUTH_TABLES],
  );
  const actual: Record<string, string[]> = {};
  for (const row of columns.rows) {
    actual[row.table_name] ??= [];
    const defaultKind = row.column_default === null ? "none" : row.column_default === "now()" ? "now" : `unexpected:${row.column_default}`;
    actual[row.table_name].push(`${row.column_name}:${row.data_type}:${row.is_nullable}:${defaultKind}`);
  }
  const expected = Object.fromEntries(Object.entries(OAUTH_COLUMN_SIGNATURES).sort());
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("The OAuth table catalog differs from the reviewed migration; refusing to continue.");
  }

  const constraints = await client<{ conname: string }>(
    `SELECT conname
       FROM pg_constraint con
       JOIN pg_class cls ON cls.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      WHERE ns.nspname = 'public' AND cls.relname = ANY($1::text[])
      ORDER BY conname`,
    [OAUTH_TABLES],
  );
  const actualConstraints = constraints.rows.map((row) => row.conname);
  const expectedConstraints = [...OAUTH_CONSTRAINTS].sort();
  if (JSON.stringify(actualConstraints) !== JSON.stringify(expectedConstraints)) {
    throw new Error("The OAuth constraint catalog differs from the reviewed migration; refusing to continue.");
  }
}
