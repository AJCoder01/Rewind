import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "pg";
import type { DatabaseQuery } from "@/lib/db/catalog";
import { evaluateDatabaseReadiness } from "@/lib/db/readiness";
import {
  FOUNDATION_MIGRATION_CHECKSUM,
  FOUNDATION_TABLES,
  OAUTH_COLUMN_SIGNATURES,
  OAUTH_CONSTRAINTS,
  OAUTH_MIGRATION_CHECKSUM,
  OAUTH_MIGRATION_ID,
  OAUTH_TABLES,
  REWIND_COLUMN_SIGNATURES,
  REWIND_CONSTRAINTS,
  REWIND_DATABASE_TABLES,
} from "@/lib/db/schema";

function queryWith(overrides: Partial<{
  database_name: string;
  role_name: string;
  tls_active: boolean;
  checksum: string | null;
  oauth_checksum: string | null;
  foundation_tables: string[];
  oauth_tables: string[];
  can_use_schema: boolean;
  can_create_schema: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolinherit: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  rolconnlimit: number;
  runtime_privileges_valid: boolean;
}> = {}): DatabaseQuery {
  return async <Row extends QueryResultRow>(text: string) => {
    let rows: QueryResultRow[];
    if (text.includes("current_database()")) {
      expect(text).toContain("SELECT table_name::text");
      rows = [{
        database_name: "postgres",
        role_name: "rewind_app",
        tls_active: true,
        checksum: FOUNDATION_MIGRATION_CHECKSUM,
        oauth_checksum: OAUTH_MIGRATION_CHECKSUM,
        foundation_tables: [...FOUNDATION_TABLES].sort(),
        oauth_tables: [...OAUTH_TABLES].sort(),
        can_use_schema: true,
        can_create_schema: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolbypassrls: false,
        rolconnlimit: 10,
        ...overrides,
      }];
    } else if (text.includes("FROM pg_class c")) {
      rows = [...REWIND_DATABASE_TABLES].sort().map((table_name) => ({ table_name, owner_name: "postgres" }));
    } else if (text.includes("SELECT table_name, column_name, data_type, is_nullable, column_default")) {
      rows = Object.entries(OAUTH_COLUMN_SIGNATURES)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([table_name, signatures]) =>
        signatures.map((signature) => {
          const [column_name, data_type, is_nullable, defaultKind] = signature.split(":");
          return { table_name, column_name, data_type, is_nullable, column_default: defaultKind === "none" ? null : "now()" };
        }),
        );
    } else if (text.includes("FROM information_schema.columns")) {
      rows = Object.entries(REWIND_COLUMN_SIGNATURES).flatMap(([table_name, signatures]) =>
        signatures.map((signature) => {
          const [column_name, data_type, is_nullable, default_kind] = signature.split(":");
          return { table_name, column_name, data_type, is_nullable, default_kind };
        }),
      );
    } else if (text.includes("SELECT conname")) {
      rows = [...OAUTH_CONSTRAINTS].sort().map((conname) => ({ conname }));
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
    } else if (text.includes("has_table_privilege")) {
      rows = [...REWIND_DATABASE_TABLES, ...OAUTH_TABLES].flatMap((table_name, tableIndex) =>
        ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"].map((privilege, privilegeIndex) => {
          const expected = table_name === "rewind_schema_migrations"
            ? privilege === "SELECT"
            : ["SELECT", "INSERT", "UPDATE", "DELETE"].includes(privilege);
          const shouldFlip = overrides.runtime_privileges_valid === false && tableIndex === 0 && privilegeIndex === 0;
          return { table_name, privilege, allowed: shouldFlip ? !expected : expected };
        }),
      );
    } else if (text.includes("has_sequence_privilege")) {
      rows = [{ select_allowed: true, usage_allowed: true, update_allowed: false }];
    } else {
      throw new Error(`Unexpected readiness query: ${text}`);
    }
    return { rows: rows as Row[] };
  };
}

describe("database readiness", () => {
  it("is ready only for the restricted TLS runtime role with the exact migration and tables", async () => {
    await expect(evaluateDatabaseReadiness(queryWith())).resolves.toEqual({
      ready: true,
      migrationId: OAUTH_MIGRATION_ID,
    });
  });

  it.each([
    { role_name: "postgres" },
    { tls_active: false },
    { can_create_schema: true },
    { rolsuper: true },
    { rolconnlimit: -1 },
    { runtime_privileges_valid: false },
    { checksum: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
    { foundation_tables: FOUNDATION_TABLES.slice(1) as unknown as string[] },
    { oauth_checksum: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
    { oauth_tables: OAUTH_TABLES.slice(1) as unknown as string[] },
  ])("fails closed for a mismatched database invariant", async (overrides) => {
    await expect(evaluateDatabaseReadiness(queryWith(overrides))).resolves.toMatchObject({ ready: false });
  });
});
