import { readFile } from "node:fs/promises";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
import { applyOAuthMigration } from "@/lib/db/oauth-migrate";
import { migrationChecksum } from "@/lib/db/migrate";
import {
  FOUNDATION_MIGRATION_CHECKSUM,
  OAUTH_COLUMN_SIGNATURES,
  OAUTH_CONSTRAINTS,
  OAUTH_MIGRATION_CHECKSUM,
  OAUTH_MIGRATION_ID,
} from "@/lib/db/schema";

async function migrationSql(): Promise<string> {
  return readFile(new URL("../../db/migrations/0002_oauth_transaction.sql", import.meta.url), "utf8");
}

function fakePool(options: { oauthApplied?: boolean; storedChecksum?: string } = {}) {
  const calls: string[] = [];
  const query = vi.fn(async <Row extends QueryResultRow>(text: string, values?: readonly unknown[]) => {
    calls.push(text);
    let rows: QueryResultRow[] = [];
    if (text.includes("table_name = 'rewind_schema_migrations'")) {
      rows = [
        { column_name: "migration_id", data_type: "text", is_nullable: "NO" },
        { column_name: "checksum", data_type: "text", is_nullable: "NO" },
        { column_name: "applied_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      ];
    } else if (text.includes("FROM information_schema.columns")) {
      rows = Object.entries(OAUTH_COLUMN_SIGNATURES)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([table_name, signatures]) =>
        signatures.map((signature) => {
          const [column_name, data_type, is_nullable, defaultKind] = signature.split(":");
          const column_default = defaultKind === "none" ? null : "now()";
          return { table_name, column_name, data_type, is_nullable, column_default };
        }),
        );
    } else if (text.includes("conrelid = 'rewind_schema_migrations'::regclass")) {
      rows = [
        { conname: "rewind_schema_migrations_checksum_check", contype: "c", definition: "CHECK checksum sha256:" },
        { conname: "rewind_schema_migrations_pkey", contype: "p", definition: "PRIMARY KEY (migration_id)" },
      ];
    } else if (text.includes("FROM pg_constraint con")) {
      rows = [...OAUTH_CONSTRAINTS].sort().map((conname) => ({ conname }));
    } else if (text.startsWith("SELECT checksum FROM rewind_schema_migrations")) {
      const migrationId = values?.[0];
      if (migrationId === "0001_phase0_foundation") rows = [{ checksum: FOUNDATION_MIGRATION_CHECKSUM }];
      if (migrationId === OAUTH_MIGRATION_ID && options.oauthApplied) {
        rows = [{ checksum: options.storedChecksum ?? OAUTH_MIGRATION_CHECKSUM }];
      }
    }
    return { rows: rows as Row[], rowCount: rows.length };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  return { pool: { connect } as unknown as Pool, client, calls, connect };
}

describe("OAuth migration runner", () => {
  it("locks, applies, catalogs, and records the reviewed migration atomically", async () => {
    const sql = await migrationSql();
    expect(migrationChecksum(sql)).toBe(OAUTH_MIGRATION_CHECKSUM);
    const fake = fakePool();
    await expect(applyOAuthMigration(fake.pool, sql)).resolves.toBe("applied");
    expect(fake.calls[0]).toBe("BEGIN");
    expect(fake.calls).toContain(sql);
    expect(fake.calls.some((text) => text.startsWith("INSERT INTO rewind_schema_migrations"))).toBe(true);
    expect(fake.calls.at(-1)).toBe("COMMIT");
    expect(fake.client.release).toHaveBeenCalledOnce();
  });

  it("rechecks the OAuth catalog and skips SQL on a matching replay", async () => {
    const sql = await migrationSql();
    const fake = fakePool({ oauthApplied: true });
    await expect(applyOAuthMigration(fake.pool, sql)).resolves.toBe("already_applied");
    expect(fake.calls.filter((text) => text === sql)).toHaveLength(0);
    expect(fake.calls.at(-1)).toBe("COMMIT");
  });

  it("refuses changed migration bytes before acquiring a database client", async () => {
    const sql = await migrationSql();
    const fake = fakePool();
    await expect(applyOAuthMigration(fake.pool, `${sql}\n`)).rejects.toThrow("checksum");
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("rolls back when an applied OAuth checksum differs", async () => {
    const sql = await migrationSql();
    const fake = fakePool({ oauthApplied: true, storedChecksum: `sha256:${"f".repeat(64)}` });
    await expect(applyOAuthMigration(fake.pool, sql)).rejects.toThrow("differs");
    expect(fake.calls.at(-1)).toBe("ROLLBACK");
    expect(fake.client.release).toHaveBeenCalledOnce();
  });
});
