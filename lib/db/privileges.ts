import type { QueryResultRow } from "pg";
import type { DatabaseQuery } from "@/lib/db/catalog";
import { REWIND_DATABASE_TABLES } from "@/lib/db/schema";

type TablePrivilegeRow = QueryResultRow & {
  table_name: string;
  privilege: string;
  allowed: boolean;
};

type SequencePrivilegeRow = QueryResultRow & {
  select_allowed: boolean;
  usage_allowed: boolean;
  update_allowed: boolean;
};

const applicationTablePrivileges = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);

export async function runtimePrivilegesMatch(query: DatabaseQuery): Promise<boolean> {
  const tableRows = await query<TablePrivilegeRow>(
    `SELECT table_name, privilege,
            has_table_privilege(current_user, format('%I.%I', 'public', table_name), privilege) AS allowed
     FROM unnest($1::text[]) AS tables(table_name)
     CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS privileges(privilege)
     ORDER BY table_name, privilege`,
    [REWIND_DATABASE_TABLES],
  );
  if (tableRows.rows.length !== REWIND_DATABASE_TABLES.length * 8) return false;

  const tablesMatch = tableRows.rows.every((row) => {
    const expected = row.table_name === "rewind_schema_migrations"
      ? row.privilege === "SELECT"
      : applicationTablePrivileges.has(row.privilege);
    return row.allowed === expected;
  });
  if (!tablesMatch) return false;

  const sequence = await query<SequencePrivilegeRow>(
    `SELECT has_sequence_privilege(current_user, 'public.audit_events_id_seq', 'SELECT') AS select_allowed,
            has_sequence_privilege(current_user, 'public.audit_events_id_seq', 'USAGE') AS usage_allowed,
            has_sequence_privilege(current_user, 'public.audit_events_id_seq', 'UPDATE') AS update_allowed`,
  );
  const row = sequence.rows[0];
  return Boolean(row?.select_allowed && row.usage_allowed && !row.update_allowed);
}
