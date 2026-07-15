import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { migrationChecksum } from "@/lib/db/migrate";
import {
  FOUNDATION_CONSTRAINTS,
  FOUNDATION_MIGRATION_CHECKSUM,
  FOUNDATION_TABLES,
} from "@/lib/db/schema";

async function migrationSql(): Promise<string> {
  return readFile(new URL("../../db/migrations/0001_phase0_foundation.sql", import.meta.url), "utf8");
}

describe("foundation migration contract", () => {
  it("binds the reviewed migration to its exact bytes", async () => {
    expect(migrationChecksum(await migrationSql())).toBe(FOUNDATION_MIGRATION_CHECKSUM);
  });

  it("canonicalizes source line endings without accepting modified migration content", async () => {
    const sql = await migrationSql();
    const lf = sql.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const crlf = lf.replaceAll("\n", "\r\n");
    expect(migrationChecksum(lf)).toBe(FOUNDATION_MIGRATION_CHECKSUM);
    expect(migrationChecksum(crlf)).toBe(FOUNDATION_MIGRATION_CHECKSUM);
    expect(migrationChecksum(`${lf}\n-- modified`)).not.toBe(FOUNDATION_MIGRATION_CHECKSUM);
  });

  it("creates every canonical application table strictly instead of masking partial schemas", async () => {
    const sql = await migrationSql();
    for (const table of FOUNDATION_TABLES) {
      expect(sql).toContain(`CREATE TABLE ${table} (`);
      expect(sql).not.toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
  });

  it("names every required check, foreign-key, primary-key, and unique constraint", async () => {
    const sql = await migrationSql();
    for (const constraint of FOUNDATION_CONSTRAINTS) {
      expect(sql).toContain(`CONSTRAINT ${constraint} `);
    }
  });

  it("revokes public/API access and grants the restricted runtime role explicitly", async () => {
    const sql = await migrationSql();
    expect(sql).toContain("REVOKE ALL ON TABLE");
    expect(sql).toContain("FROM PUBLIC");
    expect(sql).toContain("TO rewind_app");
    for (const role of ["anon", "authenticated", "service_role"]) expect(sql).toContain(`'${role}'`);
  });
});
