import type { QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import { databaseCatalogMatches, type DatabaseQuery } from "@/lib/db/catalog";
import {
  REWIND_COLUMN_SIGNATURES,
  REWIND_CONSTRAINTS,
  REWIND_DATABASE_TABLES,
} from "@/lib/db/schema";

type ColumnFixture = QueryResultRow & {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  default_kind: string;
};

type ConstraintFixture = QueryResultRow & {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  definition: string;
  is_deferrable: boolean;
  is_validated: boolean;
  update_action: string;
  delete_action: string;
};

function columnFixtures(): ColumnFixture[] {
  return Object.entries(REWIND_COLUMN_SIGNATURES).flatMap(([table_name, signatures]) =>
    signatures.map((signature) => {
      const [column_name, data_type, is_nullable, default_kind] = signature.split(":");
      if (!column_name || !data_type || (is_nullable !== "YES" && is_nullable !== "NO") || !default_kind) {
        throw new Error(`Invalid test column signature for ${table_name}`);
      }
      return { table_name, column_name, data_type, is_nullable, default_kind };
    }),
  );
}

function constraintFixtures(): ConstraintFixture[] {
  return REWIND_CONSTRAINTS.map((constraint) => ({
    table_name: constraint.table,
    constraint_name: constraint.name,
    constraint_type: constraint.type,
    definition: postgres17Definition(constraint.definition),
    is_deferrable: false,
    is_validated: true,
    update_action: constraint.type === "FOREIGN KEY" ? "a" : " ",
    delete_action: constraint.type === "FOREIGN KEY" ? "a" : " ",
  }));
}

function postgres17Definition(definition: string): string {
  const enumCheck = /^CHECK \(([a-z_]+) IN \((.*)\)\)$/u.exec(definition);
  if (enumCheck) {
    const values = enumCheck[2].split(", ").map((value) => `${value}::text`);
    return `CHECK (${enumCheck[1]} = ANY (ARRAY[${values.join(", ")}]))`;
  }
  if (definition.startsWith("CHECK (checksum")) {
    return definition.replace("CHECK (", "CHECK ((").replace("')", "'::text))");
  }
  return definition.replace("REFERENCES ", "REFERENCES public.");
}

function queryWith(overrides: {
  columns?: ColumnFixture[];
  constraints?: ConstraintFixture[];
} = {}): DatabaseQuery {
  const columns = overrides.columns ?? columnFixtures();
  const constraints = overrides.constraints ?? constraintFixtures();
  return async <Row extends QueryResultRow>(text: string) => {
    let rows: QueryResultRow[];
    if (text.includes("FROM pg_class c")) {
      rows = [...REWIND_DATABASE_TABLES].sort().map((table_name) => ({ table_name, owner_name: "postgres" }));
    } else if (text.includes("FROM information_schema.columns")) {
      rows = columns;
    } else if (text.includes("FROM pg_constraint con")) {
      rows = constraints;
    } else {
      throw new Error(`Unexpected catalog query: ${text}`);
    }
    return { rows: rows as Row[] };
  };
}

describe("database catalog", () => {
  it("accepts the exact foundation columns and PostgreSQL 17 constraint rendering", async () => {
    await expect(databaseCatalogMatches(queryWith())).resolves.toBe(true);
  });

  it("rejects a missing expected column", async () => {
    const columns = columnFixtures().filter(
      (column) => !(column.table_name === "tasks" && column.column_name === "request"),
    );
    await expect(databaseCatalogMatches(queryWith({ columns }))).resolves.toBe(false);
  });

  it("rejects column type, nullability, or default drift", async () => {
    const columns = columnFixtures().map((column) =>
      column.table_name === "tasks" && column.column_name === "created_at"
        ? { ...column, default_kind: "none" }
        : column,
    );
    await expect(databaseCatalogMatches(queryWith({ columns }))).resolves.toBe(false);
  });

  it("rejects a broadened status check even when every required value remains", async () => {
    const constraints = constraintFixtures().map((constraint) =>
      constraint.constraint_name === "tasks_status_check"
        ? { ...constraint, definition: constraint.definition.replace("'failed'::text", "'failed'::text, 'unsafe'::text") }
        : constraint,
    );
    await expect(databaseCatalogMatches(queryWith({ constraints }))).resolves.toBe(false);
  });

  it("rejects a weakened migration-checksum expression", async () => {
    const constraints = constraintFixtures().map((constraint) =>
      constraint.constraint_name === "rewind_schema_migrations_checksum_check"
        ? { ...constraint, definition: constraint.definition.replace("[a-f0-9]{64}", ".*") }
        : constraint,
    );
    await expect(databaseCatalogMatches(queryWith({ constraints }))).resolves.toBe(false);
  });
});
