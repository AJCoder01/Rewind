import type { QueryResultRow } from "pg";
import {
  REWIND_COLUMN_SIGNATURES,
  REWIND_CONSTRAINTS,
  REWIND_DATABASE_TABLES,
} from "@/lib/db/schema";

export interface DatabaseQuery {
  <Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

type TableRow = QueryResultRow & { table_name: string; owner_name: string };
type ColumnRow = QueryResultRow & {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  default_kind: string;
};
type ConstraintRow = QueryResultRow & {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  definition: string;
  is_deferrable: boolean;
  is_validated: boolean;
  update_action: string;
  delete_action: string;
};

export async function databaseCatalogMatches(query: DatabaseQuery): Promise<boolean> {
  const tables = await query<TableRow>(
    `SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])
     ORDER BY c.relname`,
    [REWIND_DATABASE_TABLES],
  );
  const actualTables = tables.rows.map((row) => row.table_name);
  if (
    JSON.stringify(actualTables) !== JSON.stringify([...REWIND_DATABASE_TABLES].sort()) ||
    tables.rows.some((row) => row.owner_name !== "postgres")
  ) {
    return false;
  }

  const columns = await query<ColumnRow>(
    `SELECT table_name, column_name, data_type, is_nullable,
            CASE
              WHEN column_default IS NULL THEN 'none'
              WHEN column_default = 'now()' THEN 'now'
              WHEN column_default = '0' THEN 'zero'
              WHEN column_default LIKE 'nextval(%' THEN 'sequence'
              WHEN column_default = '''{}''::jsonb' THEN 'empty_json'
              ELSE 'unexpected:' || column_default
            END AS default_kind
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name, ordinal_position`,
    [REWIND_DATABASE_TABLES],
  );
  const actualColumns: Record<string, string[]> = {};
  for (const row of columns.rows) {
    actualColumns[row.table_name] ??= [];
    actualColumns[row.table_name].push(
      `${row.column_name}:${row.data_type}:${row.is_nullable}:${row.default_kind}`,
    );
  }
  if (catalogSignature(actualColumns) !== catalogSignature(REWIND_COLUMN_SIGNATURES)) return false;

  const constraints = await query<ConstraintRow>(
    `SELECT cls.relname AS table_name,
            con.conname AS constraint_name,
            CASE con.contype
              WHEN 'p' THEN 'PRIMARY KEY'
              WHEN 'f' THEN 'FOREIGN KEY'
              WHEN 'u' THEN 'UNIQUE'
              WHEN 'c' THEN 'CHECK'
              ELSE con.contype::text
            END AS constraint_type,
            pg_get_constraintdef(con.oid, true) AS definition,
            con.condeferrable AS is_deferrable,
            con.convalidated AS is_validated,
            con.confupdtype::text AS update_action,
            con.confdeltype::text AS delete_action
     FROM pg_constraint con
     JOIN pg_class cls ON cls.oid = con.conrelid
     JOIN pg_namespace ns ON ns.oid = cls.relnamespace
     WHERE ns.nspname = 'public' AND cls.relname = ANY($1::text[])
     ORDER BY cls.relname, con.conname`,
    [REWIND_DATABASE_TABLES],
  );
  if (constraints.rows.length !== REWIND_CONSTRAINTS.length) return false;

  const actualByName = new Map(constraints.rows.map((row) => [row.constraint_name, row]));
  return REWIND_CONSTRAINTS.every((expected) => {
    const actual = actualByName.get(expected.name);
    if (!actual || actual.table_name !== expected.table || actual.constraint_type !== expected.type) return false;
    if (actual.is_deferrable || !actual.is_validated) return false;
    if (expected.type === "FOREIGN KEY" && (actual.update_action !== "a" || actual.delete_action !== "a")) return false;
    return normalizeConstraintDefinition(actual.definition) === normalizeConstraintDefinition(expected.definition);
  });
}

export async function assertDatabaseCatalog(query: DatabaseQuery): Promise<void> {
  if (!(await databaseCatalogMatches(query))) {
    throw new Error("The live database catalog does not match the reviewed foundation schema.");
  }
}

function catalogSignature(signatures: Readonly<Record<string, readonly string[]>>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(signatures).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function normalizeConstraintDefinition(definition: string): string {
  let normalized = definition
    .replace(/::(?:text|name|character varying)/gi, "")
    .replace(/"([a-z_][a-z0-9_]*)"/gi, "$1")
    .replace(/\bpublic\./gi, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/=any\(array\[(.*?)\]\)/g, "in($1)");

  while (normalized.startsWith("check((") && normalized.endsWith("))")) {
    normalized = `check(${normalized.slice(7, -2)})`;
  }
  return normalized;
}
