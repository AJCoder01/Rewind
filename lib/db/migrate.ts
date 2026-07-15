import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { assertDatabaseCatalog } from "@/lib/db/catalog";
import {
  FOUNDATION_MIGRATION_CHECKSUM,
  FOUNDATION_MIGRATION_ID,
  isKnownFoundationMigrationChecksum,
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

export function migrationChecksum(sql: string): string {
  const canonicalSql = sql.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return `sha256:${createHash("sha256").update(canonicalSql, "utf8").digest("hex")}`;
}

export async function applyFoundationMigration(pool: Pool, sql: string): Promise<"applied" | "already_applied"> {
  const checksum = migrationChecksum(sql);
  if (checksum !== FOUNDATION_MIGRATION_CHECKSUM) {
    throw new Error("Migration checksum does not match the reviewed foundation migration; no database connection was attempted.");
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

    const existing = await client.query<{ checksum: string }>(
      "SELECT checksum FROM rewind_schema_migrations WHERE migration_id = $1",
      [FOUNDATION_MIGRATION_ID],
    );
    if (existing.rowCount) {
      if (!isKnownFoundationMigrationChecksum(existing.rows[0].checksum)) {
        throw new Error("The applied foundation migration checksum differs from the reviewed migration; refusing to continue.");
      }
      await assertDatabaseCatalog((text, values) => client.query(text, values ? [...values] : undefined));
      await client.query("COMMIT");
      transactionStarted = false;
      return "already_applied";
    }

    await client.query(sql);
    await assertDatabaseCatalog((text, values) => client.query(text, values ? [...values] : undefined));
    await client.query(
      "INSERT INTO rewind_schema_migrations (migration_id, checksum) VALUES ($1, $2)",
      [FOUNDATION_MIGRATION_ID, checksum],
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

export async function assertMigrationLedgerShape(client: PoolClient): Promise<void> {
  const result = await client.query<{
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
  }>(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'rewind_schema_migrations'
     ORDER BY ordinal_position`,
  );
  const actual = result.rows.map(({ column_name, data_type, is_nullable }) => [column_name, data_type, is_nullable]);
  const expected = [
    ["migration_id", "text", "NO"],
    ["checksum", "text", "NO"],
    ["applied_at", "timestamp with time zone", "NO"],
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("The migration ledger has an unexpected shape; refusing to apply application tables.");
  }

  const constraints = await client.query<{ conname: string; contype: string; definition: string }>(
    `SELECT conname, contype::text, pg_get_constraintdef(oid, true) AS definition
     FROM pg_constraint
     WHERE conrelid = 'rewind_schema_migrations'::regclass
     ORDER BY conname`,
  );
  const constraintSignature = constraints.rows.map(({ conname, contype, definition }) => ({ conname, contype, definition }));
  const primaryKey = constraintSignature.find(({ conname }) => conname === "rewind_schema_migrations_pkey");
  const checksumCheck = constraintSignature.find(({ conname }) => conname === "rewind_schema_migrations_checksum_check");
  if (
    constraintSignature.length !== 2 ||
    primaryKey?.contype !== "p" ||
    !primaryKey.definition.includes("PRIMARY KEY (migration_id)") ||
    checksumCheck?.contype !== "c" ||
    !checksumCheck.definition.includes("checksum") ||
    !checksumCheck.definition.includes("sha256:")
  ) {
    throw new Error("The migration ledger constraints are invalid; refusing to apply application tables.");
  }
}
