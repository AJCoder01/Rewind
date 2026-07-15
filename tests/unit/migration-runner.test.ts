import { readFile } from "node:fs/promises";
import type { Pool, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
import { applyFoundationMigration } from "@/lib/db/migrate";
import {
  FOUNDATION_MIGRATION_CHECKSUM,
  FOUNDATION_MIGRATION_LEGACY_CRLF_CHECKSUM,
  REWIND_COLUMN_SIGNATURES,
  REWIND_CONSTRAINTS,
  REWIND_DATABASE_TABLES,
} from "@/lib/db/schema";

type FakeOptions = {
  storedChecksum?: string | null;
  malformedLedger?: boolean;
  failMigration?: boolean;
};

async function migrationSql(): Promise<string> {
  return readFile(new URL("../../db/migrations/0001_phase0_foundation.sql", import.meta.url), "utf8");
}

function fakePool(sql: string, options: FakeOptions = {}) {
  const calls: string[] = [];
  const query = vi.fn(async <Row extends QueryResultRow>(text: string) => {
    calls.push(text);
    let rows: QueryResultRow[] = [];
    if (text.includes("table_name = 'rewind_schema_migrations'")) {
      rows = options.malformedLedger
        ? [{ column_name: "migration_id", data_type: "text", is_nullable: "NO" }]
        : [
            { column_name: "migration_id", data_type: "text", is_nullable: "NO" },
            { column_name: "checksum", data_type: "text", is_nullable: "NO" },
            { column_name: "applied_at", data_type: "timestamp with time zone", is_nullable: "NO" },
          ];
    } else if (text.includes("FROM information_schema.columns")) {
      rows = Object.entries(REWIND_COLUMN_SIGNATURES).flatMap(([table_name, signatures]) =>
        signatures.map((signature) => {
          const [column_name, data_type, is_nullable, default_kind] = signature.split(":");
          return { table_name, column_name, data_type, is_nullable, default_kind };
        }),
      );
    } else if (text.includes("conrelid = 'rewind_schema_migrations'::regclass")) {
      rows = [
        { conname: "rewind_schema_migrations_checksum_check", contype: "c", definition: "CHECK checksum sha256:" },
        { conname: "rewind_schema_migrations_pkey", contype: "p", definition: "PRIMARY KEY (migration_id)" },
      ];
    } else if (text.startsWith("SELECT checksum FROM rewind_schema_migrations")) {
      rows = options.storedChecksum === undefined || options.storedChecksum === null
        ? []
        : [{ checksum: options.storedChecksum }];
    } else if (text.includes("FROM pg_class c")) {
      rows = [...REWIND_DATABASE_TABLES].sort().map((table_name) => ({ table_name, owner_name: "postgres" }));
    } else if (text.includes("FROM pg_constraint con")) {
      rows = REWIND_CONSTRAINTS.map((constraint) => ({
        table_name: constraint.table,
        constraint_name: constraint.name,
        constraint_type: constraint.type,
        definition: constraint.definition,
        is_deferrable: false,
        is_validated: true,
        update_action: constraint.type === "FOREIGN KEY" ? "a" : " ",
        delete_action: constraint.type === "FOREIGN KEY" ? "a" : " ",
      }));
    } else if (text === sql && options.failMigration) {
      throw new Error("synthetic migration failure");
    }
    return { rows: rows as Row[], rowCount: rows.length };
  });
  const client = { query, release: vi.fn() };
  const connect = vi.fn(async () => client);
  return { pool: { connect } as unknown as Pool, client, calls, connect };
}

describe("foundation migration runner", () => {
  it("applies the strict migration and ledger row inside one committed transaction", async () => {
    const sql = await migrationSql();
    const fake = fakePool(sql);

    await expect(applyFoundationMigration(fake.pool, sql)).resolves.toBe("applied");
    expect(fake.calls[0]).toBe("BEGIN");
    expect(fake.calls).toContain("SET LOCAL search_path TO public, pg_catalog");
    expect(fake.calls).toContain(sql);
    expect(fake.calls.some((text) => text.startsWith("INSERT INTO rewind_schema_migrations"))).toBe(true);
    expect(fake.calls.at(-1)).toBe("COMMIT");
    expect(fake.client.release).toHaveBeenCalledOnce();
  });

  it("rechecks the complete catalog and skips migration SQL for the matching ledger entry", async () => {
    const sql = await migrationSql();
    const fake = fakePool(sql, { storedChecksum: FOUNDATION_MIGRATION_CHECKSUM });

    await expect(applyFoundationMigration(fake.pool, sql)).resolves.toBe("already_applied");
    expect(fake.calls.filter((text) => text === sql)).toHaveLength(0);
    expect(fake.calls.some((text) => text.includes("FROM pg_constraint con"))).toBe(true);
    expect(fake.calls.at(-1)).toBe("COMMIT");
  });

  it("accepts only the known legacy CRLF checksum for an existing foundation ledger row", async () => {
    const sql = await migrationSql();
    const fake = fakePool(sql, { storedChecksum: FOUNDATION_MIGRATION_LEGACY_CRLF_CHECKSUM });

    await expect(applyFoundationMigration(fake.pool, sql)).resolves.toBe("already_applied");
    expect(fake.calls.filter((text) => text === sql)).toHaveLength(0);
  });

  it("refuses modified migration bytes before acquiring a database client", async () => {
    const sql = await migrationSql();
    const fake = fakePool(sql);

    await expect(applyFoundationMigration(fake.pool, `${sql}\n`)).rejects.toThrow("checksum");
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("rolls back when the stored checksum differs", async () => {
    const sql = await migrationSql();
    const fake = fakePool(sql, { storedChecksum: `sha256:${"f".repeat(64)}` });

    await expect(applyFoundationMigration(fake.pool, sql)).rejects.toThrow("differs");
    expect(fake.calls.at(-1)).toBe("ROLLBACK");
    expect(fake.client.release).toHaveBeenCalledOnce();
  });

  it("refuses a malformed ledger before application", async () => {
    const sql = await migrationSql();
    const fake = fakePool(sql, { malformedLedger: true });

    await expect(applyFoundationMigration(fake.pool, sql)).rejects.toThrow("ledger has an unexpected shape");
    expect(fake.calls).not.toContain(sql);
    expect(fake.calls.at(-1)).toBe("ROLLBACK");
  });

  it("rolls back a migration failure without recording the ledger entry", async () => {
    const sql = await migrationSql();
    const fake = fakePool(sql, { failMigration: true });

    await expect(applyFoundationMigration(fake.pool, sql)).rejects.toThrow("synthetic migration failure");
    expect(fake.calls.some((text) => text.startsWith("INSERT INTO rewind_schema_migrations"))).toBe(false);
    expect(fake.calls.at(-1)).toBe("ROLLBACK");
    expect(fake.client.release).toHaveBeenCalledOnce();
  });
});
