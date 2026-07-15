import { Pool } from "pg";
import type { QueryResultRow } from "pg";
import { databaseCatalogMatches, type DatabaseQuery } from "@/lib/db/catalog";
import { requireDatabaseUrl } from "@/lib/db/config";
import { assertOAuthCatalog } from "@/lib/db/oauth-migrate";
import { runtimePrivilegesMatch } from "@/lib/db/privileges";
import {
  FOUNDATION_MIGRATION_ID,
  isKnownFoundationMigrationChecksum,
  FOUNDATION_TABLES,
  OAUTH_MIGRATION_CHECKSUM,
  OAUTH_MIGRATION_ID,
  OAUTH_TABLES,
} from "@/lib/db/schema";

type ReadinessRow = QueryResultRow & {
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
};

export type DatabaseReadiness = {
  ready: boolean;
  migrationId: string;
};

let readinessPool: Pool | undefined;

export async function checkDatabaseReadiness(): Promise<DatabaseReadiness> {
  readinessPool ??= new Pool({
    connectionString: requireDatabaseUrl("DATABASE_URL"),
    max: 1,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  return evaluateDatabaseReadiness(<Row extends QueryResultRow>(text: string, values?: readonly unknown[]) =>
    readinessPool!.query<Row>(text, values ? [...values] : undefined),
  );
}

export async function evaluateDatabaseReadiness(query: DatabaseQuery): Promise<DatabaseReadiness> {
  const result = await query<ReadinessRow>(
    `SELECT current_database() AS database_name,
            current_user AS role_name,
            COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls_active,
            has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
            has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema,
            r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolinherit,
            r.rolreplication, r.rolbypassrls, r.rolconnlimit,
            (SELECT checksum FROM rewind_schema_migrations WHERE migration_id = $1) AS checksum,
            (SELECT checksum FROM rewind_schema_migrations WHERE migration_id = $3) AS oauth_checksum,
            ARRAY(
              SELECT table_name::text
              FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = ANY($2::text[])
              ORDER BY table_name
            ) AS foundation_tables,
            ARRAY(
              SELECT table_name::text
              FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = ANY($4::text[])
              ORDER BY table_name
            ) AS oauth_tables
     FROM pg_roles r
     WHERE r.rolname = current_user`,
    [FOUNDATION_MIGRATION_ID, FOUNDATION_TABLES, OAUTH_MIGRATION_ID, OAUTH_TABLES],
  );
  const row = result.rows[0];
  const expectedTables = [...FOUNDATION_TABLES].sort();
  const expectedOAuthTables = [...OAUTH_TABLES].sort();
  const actualTables = row?.foundation_tables ?? [];
  const actualOAuthTables = row?.oauth_tables ?? [];
  const identityReady = Boolean(
      row &&
        row.database_name === "postgres" &&
        row.role_name === "rewind_app" &&
        row.tls_active &&
        row.can_use_schema &&
        !row.can_create_schema &&
        !row.rolsuper &&
        !row.rolcreatedb &&
        !row.rolcreaterole &&
        !row.rolinherit &&
        !row.rolreplication &&
        !row.rolbypassrls &&
        row.rolconnlimit === 10 &&
        typeof row.checksum === "string" &&
        isKnownFoundationMigrationChecksum(row.checksum) &&
        row.oauth_checksum === OAUTH_MIGRATION_CHECKSUM &&
        JSON.stringify(actualTables) === JSON.stringify(expectedTables) &&
        JSON.stringify(actualOAuthTables) === JSON.stringify(expectedOAuthTables),
  );
  const catalogReady = identityReady ? await databaseCatalogMatches(query) && (await oauthCatalogMatches(query)) : false;
  const privilegesReady = catalogReady ? await runtimePrivilegesMatch(query) : false;
  return {
    ready: identityReady && catalogReady && privilegesReady,
    migrationId: OAUTH_MIGRATION_ID,
  };
}

async function oauthCatalogMatches(query: DatabaseQuery): Promise<boolean> {
  try {
    await assertOAuthCatalog(query);
    return true;
  } catch {
    return false;
  }
}
