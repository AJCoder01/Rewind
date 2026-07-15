import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseCatalogMatches } from "@/lib/db/catalog";
import { loadPrivateLocalEnvironment, requireDatabaseUrl } from "@/lib/db/config";
import { runtimePrivilegesMatch } from "@/lib/db/privileges";
import { evaluateDatabaseReadiness } from "@/lib/db/readiness";
import {
  FOUNDATION_MIGRATION_CHECKSUM,
  FOUNDATION_MIGRATION_ID,
  REWIND_COLUMN_SIGNATURES,
  REWIND_CONSTRAINTS,
  REWIND_DATABASE_TABLES,
} from "@/lib/db/schema";

type VerificationChecks = Record<string, boolean>;

export type DefaultPrivilegeRow = {
  scope: string;
  object_type: string;
  grantee: string;
  privileges: string[];
  any_grantable: boolean;
};

const expectedDefaultPrivileges: readonly DefaultPrivilegeRow[] = [
  {
    scope: "global",
    object_type: "f",
    grantee: "postgres",
    privileges: ["EXECUTE"],
    any_grantable: false,
  },
  {
    scope: "public",
    object_type: "S",
    grantee: "postgres",
    privileges: ["SELECT", "UPDATE", "USAGE"],
    any_grantable: false,
  },
  {
    scope: "public",
    object_type: "S",
    grantee: "rewind_app",
    privileges: ["SELECT", "USAGE"],
    any_grantable: false,
  },
  {
    scope: "public",
    object_type: "f",
    grantee: "postgres",
    privileges: ["EXECUTE"],
    any_grantable: false,
  },
  {
    scope: "public",
    object_type: "r",
    grantee: "postgres",
    privileges: ["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"],
    any_grantable: false,
  },
  {
    scope: "public",
    object_type: "r",
    grantee: "rewind_app",
    privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    any_grantable: false,
  },
] as const;

export const DEFAULT_PRIVILEGES_SQL = `SELECT CASE
              WHEN d.defaclnamespace = 0 THEN 'global'
              WHEN namespace.nspname IS NULL THEN 'unknown:' || d.defaclnamespace::text
              ELSE namespace.nspname
            END AS scope,
            d.defaclobjtype::text AS object_type,
            CASE
              WHEN e.grantee = 0 THEN 'PUBLIC'
              WHEN grantee.rolname IS NULL THEN 'unknown:' || e.grantee::text
              ELSE grantee.rolname
            END AS grantee,
            array_agg(e.privilege_type ORDER BY e.privilege_type) AS privileges,
            bool_or(e.is_grantable) AS any_grantable
     FROM pg_default_acl d
     CROSS JOIN LATERAL aclexplode(d.defaclacl) e
     JOIN pg_roles owner ON owner.oid = d.defaclrole
     LEFT JOIN pg_namespace namespace ON namespace.oid = d.defaclnamespace
     LEFT JOIN pg_roles grantee ON grantee.oid = e.grantee
     WHERE owner.rolname = 'postgres'
       AND (d.defaclnamespace = 0 OR namespace.nspname = 'public')
       AND d.defaclobjtype IN ('r', 'S', 'f')
     GROUP BY d.defaclnamespace, namespace.nspname, d.defaclobjtype, e.grantee, grantee.rolname
     ORDER BY scope, object_type, grantee`;

async function main(): Promise<void> {
  loadPrivateLocalEnvironment();
  const runtimeUrl = requireDatabaseUrl("DATABASE_URL");
  const migrationUrl = requireDatabaseUrl("DATABASE_MIGRATION_URL");
  const runtimePool = new Pool({ connectionString: runtimeUrl, max: 1, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  const migrationPool = new Pool({ connectionString: migrationUrl, max: 1, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  let runtime: PoolClient | undefined;
  let migration: PoolClient | undefined;
  try {
    runtime = await runtimePool.connect();
    migration = await migrationPool.connect();
    const checks: VerificationChecks = {
      ...(await verifyIdentityAndTls(runtime, migration)),
      exactCatalog: await databaseCatalogMatches(queryFrom(runtime)),
      exactColumnsAndDefaults: await verifyColumns(migration),
      exactConstraintCount: await verifyConstraintCount(migration),
      exactRuntimePrivileges: await runtimePrivilegesMatch(queryFrom(runtime)),
      publicAndApiRolesExcluded: await verifyExcludedRoles(migration),
      exactDefaultPrivileges: await verifyDefaultPrivileges(migration),
      migrationLedgerExact: await verifyMigrationLedger(migration),
      uniquenessAndChecksEnforcedWithoutResidue: await verifyConstraintBehavior(runtime),
      readinessPasses: (await evaluateDatabaseReadiness(queryFrom(runtime))).ready,
    };
    const plaintext = await verifyPlaintextRejection(runtimeUrl);
    checks.plaintextConnectionRejected = plaintext.rejected;
    checks.plaintextRejectionWasSslSpecific = plaintext.sslSpecific;
    process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
    if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
  } finally {
    runtime?.release();
    migration?.release();
    await runtimePool.end();
    await migrationPool.end();
  }
}

function queryFrom(client: PoolClient) {
  return <Row extends QueryResultRow>(text: string, values?: readonly unknown[]) =>
    client.query<Row>(text, values ? [...values] : undefined);
}

async function verifyIdentityAndTls(runtime: PoolClient, migration: PoolClient): Promise<VerificationChecks> {
  const runtimeRow = (await runtime.query<{
    current_user: string;
    database_name: string;
    tls_active: boolean;
    can_use_schema: boolean;
    can_create_schema: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolinherit: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    rolconnlimit: number;
  }>(
    `SELECT current_user,
            current_database() AS database_name,
            COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls_active,
            has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
            has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema,
            r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolinherit,
            r.rolreplication, r.rolbypassrls, r.rolconnlimit
     FROM pg_roles r WHERE r.rolname = current_user`,
  )).rows[0];
  const migrationRow = (await migration.query<{ current_user: string; database_name: string; tls_active: boolean }>(
    `SELECT current_user,
            current_database() AS database_name,
            COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls_active`,
  )).rows[0];
  return {
    runtimeIdentity: runtimeRow.current_user === "rewind_app" && runtimeRow.database_name === "postgres",
    runtimeTls: runtimeRow.tls_active,
    runtimeSchemaRestricted: runtimeRow.can_use_schema && !runtimeRow.can_create_schema,
    runtimeRoleRestricted:
      !runtimeRow.rolsuper &&
      !runtimeRow.rolcreatedb &&
      !runtimeRow.rolcreaterole &&
      !runtimeRow.rolinherit &&
      !runtimeRow.rolreplication &&
      !runtimeRow.rolbypassrls &&
      runtimeRow.rolconnlimit === 10,
    migrationIdentity: migrationRow.current_user === "postgres" && migrationRow.database_name === "postgres",
    migrationTls: migrationRow.tls_active,
  };
}

async function verifyColumns(client: PoolClient): Promise<boolean> {
  const rows = (await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
    default_kind: string;
  }>(
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
  )).rows;
  const actual: Record<string, string[]> = {};
  for (const row of rows) {
    actual[row.table_name] ??= [];
    actual[row.table_name].push(`${row.column_name}:${row.data_type}:${row.is_nullable}:${row.default_kind}`);
  }
  return JSON.stringify(actual) === JSON.stringify(Object.fromEntries(Object.entries(REWIND_COLUMN_SIGNATURES).sort()));
}

async function verifyConstraintCount(client: PoolClient): Promise<boolean> {
  const row = (await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM pg_constraint con
     JOIN pg_class cls ON cls.oid = con.conrelid
     JOIN pg_namespace ns ON ns.oid = cls.relnamespace
     WHERE ns.nspname = 'public' AND cls.relname = ANY($1::text[])`,
    [REWIND_DATABASE_TABLES],
  )).rows[0];
  return row.count === REWIND_CONSTRAINTS.length;
}

async function verifyExcludedRoles(client: PoolClient): Promise<boolean> {
  const rows = (await client.query<{ role_name: string; allowed_count: number }>(
    `SELECT role_name,
            count(*) FILTER (
              WHERE has_table_privilege(role_name::name, format('%I.%I', 'public', table_name), privilege)
            )::int AS allowed_count
     FROM unnest(ARRAY['anon','authenticated','service_role']) AS roles(role_name)
     CROSS JOIN unnest($1::text[]) AS tables(table_name)
     CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS privileges(privilege)
     GROUP BY role_name
     ORDER BY role_name`,
    [REWIND_DATABASE_TABLES],
  )).rows;
  const tableAccessAbsent = rows.length === 3 && rows.every((row) => row.allowed_count === 0);
  const sequenceRows = (await client.query<{ role_name: string; allowed: boolean }>(
    `SELECT role_name,
            has_sequence_privilege(role_name::name, 'public.audit_events_id_seq', privilege) AS allowed
     FROM unnest(ARRAY['anon','authenticated','service_role']) AS roles(role_name)
     CROSS JOIN unnest(ARRAY['SELECT','USAGE','UPDATE']) AS privileges(privilege)`,
  )).rows;
  const publicAcl = (await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner))) acl
     WHERE n.nspname = 'public'
       AND (c.relname = ANY($1::text[]) OR c.relname = 'audit_events_id_seq')
       AND acl.grantee = 0`,
    [REWIND_DATABASE_TABLES],
  )).rows[0];
  return tableAccessAbsent && sequenceRows.every((row) => !row.allowed) && publicAcl.count === 0;
}

async function verifyDefaultPrivileges(client: PoolClient): Promise<boolean> {
  const rows = (await client.query<DefaultPrivilegeRow>(DEFAULT_PRIVILEGES_SQL)).rows;
  return defaultPrivilegesMatch(rows);
}

export function defaultPrivilegesMatch(rows: readonly DefaultPrivilegeRow[]): boolean {
  const actual = rows.map(defaultPrivilegeSignature).sort();
  const expected = expectedDefaultPrivileges.map(defaultPrivilegeSignature).sort();
  return actual.length === expected.length && actual.every((signature, index) => signature === expected[index]);
}

function defaultPrivilegeSignature(row: DefaultPrivilegeRow): string {
  const privileges = [...row.privileges].sort();
  return [row.scope, row.object_type, row.grantee, row.any_grantable ? "grantable" : "not_grantable", ...privileges].join("|");
}

async function verifyMigrationLedger(client: PoolClient): Promise<boolean> {
  const rows = (await client.query<{ migration_id: string; checksum: string }>(
    "SELECT migration_id, checksum FROM rewind_schema_migrations ORDER BY migration_id",
  )).rows;
  return rows.length === 1 && rows[0].migration_id === FOUNDATION_MIGRATION_ID && rows[0].checksum === FOUNDATION_MIGRATION_CHECKSUM;
}

async function verifyConstraintBehavior(client: PoolClient): Promise<boolean> {
  const suffix = randomUUID().replaceAll("-", "");
  const prefix = `s008_verify_${suffix}`;
  let actionUnique = false;
  let idempotencyUnique = false;
  let actionCheck = false;
  let idempotencyCheck = false;
  let taskCheck = false;
  let planCheck = false;
  let ruleCheck = false;
  let foreignKey = false;
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO tasks (id, run_id, request, status, read_model) VALUES ($1, $2, $3, 'analyzing', '{}'::jsonb)",
      [`${prefix}_task`, `${prefix}_run`, "S008 rolled-back verification"],
    );
    await client.query(
      "INSERT INTO plans (id, task_id, kind, version, schema_version, payload, digest) VALUES ($1, $2, 'initial', 1, 'verification.v1', '{}'::jsonb, $3)",
      [`${prefix}_plan`, `${prefix}_task`, `sha256:${"0".repeat(64)}`],
    );
    await client.query(
      "INSERT INTO action_executions (id, plan_id, action_key, type, target_ref, status, action) VALUES ($1, $2, 'verification.action', 'artifact.account_brief', 'verification', 'planned', '{}'::jsonb)",
      [`${prefix}_action1`, `${prefix}_plan`],
    );
    actionUnique = await expectDatabaseError(
      client,
      "action_unique",
      "INSERT INTO action_executions (id, plan_id, action_key, type, target_ref, status, action) VALUES ($1, $2, 'verification.action', 'artifact.account_brief', 'verification', 'planned', '{}'::jsonb)",
      [`${prefix}_action2`, `${prefix}_plan`],
      "23505",
      "action_executions_plan_id_action_key_key",
    );
    await client.query(
      "INSERT INTO idempotency_records (actor_id, endpoint, key, body_hash, status) VALUES ($1, 'verification', 'verification-key', $2, 'in_progress')",
      [`${prefix}_actor`, `sha256:${"1".repeat(64)}`],
    );
    idempotencyUnique = await expectDatabaseError(
      client,
      "idempotency_unique",
      "INSERT INTO idempotency_records (actor_id, endpoint, key, body_hash, status) VALUES ($1, 'verification', 'verification-key', $2, 'in_progress')",
      [`${prefix}_actor`, `sha256:${"1".repeat(64)}`],
      "23505",
      "idempotency_records_pkey",
    );
    actionCheck = await expectDatabaseError(
      client,
      "action_check",
      "INSERT INTO action_executions (id, plan_id, action_key, type, target_ref, status, action) VALUES ($1, $2, 'verification.invalid', 'test', 'test', 'invalid', '{}'::jsonb)",
      [`${prefix}_bad_action`, `${prefix}_plan`],
      "23514",
      "action_executions_status_check",
    );
    idempotencyCheck = await expectDatabaseError(
      client,
      "idempotency_check",
      "INSERT INTO idempotency_records (actor_id, endpoint, key, body_hash, status) VALUES ($1, 'verification', 'invalid-key', $2, 'invalid')",
      [`${prefix}_actor`, `sha256:${"2".repeat(64)}`],
      "23514",
      "idempotency_records_status_check",
    );
    taskCheck = await expectDatabaseError(
      client,
      "task_check",
      "INSERT INTO tasks (id, request, status, read_model) VALUES ($1, 'verification', 'invalid', '{}'::jsonb)",
      [`${prefix}_bad_task`],
      "23514",
      "tasks_status_check",
    );
    planCheck = await expectDatabaseError(
      client,
      "plan_check",
      "INSERT INTO plans (id, task_id, kind, version, schema_version, payload, digest) VALUES ($1, $2, 'invalid', 2, 'verification.v1', '{}'::jsonb, $3)",
      [`${prefix}_bad_plan`, `${prefix}_task`, `sha256:${"3".repeat(64)}`],
      "23514",
      "plans_kind_check",
    );
    ruleCheck = await expectDatabaseError(
      client,
      "rule_check",
      "INSERT INTO prevention_rules (id, source_task_id, condition, display_copy, status) VALUES ($1, $2, '{}'::jsonb, 'verification', 'invalid')",
      [`${prefix}_bad_rule`, `${prefix}_task`],
      "23514",
      "prevention_rules_status_check",
    );
    foreignKey = await expectDatabaseError(
      client,
      "foreign_key",
      "INSERT INTO scenario_locks (scenario_key, task_id, acquired_at) VALUES ($1, $2, now())",
      [`${prefix}_bad_lock`, `${prefix}_missing_task`],
      "23503",
      "scenario_locks_task_id_fkey",
    );
  } finally {
    await client.query("ROLLBACK");
  }
  const residue = (await client.query<{ count: number }>(
    `SELECT (
       (SELECT count(*) FROM tasks WHERE id LIKE $1) +
       (SELECT count(*) FROM plans WHERE id LIKE $1) +
       (SELECT count(*) FROM action_executions WHERE id LIKE $1) +
       (SELECT count(*) FROM idempotency_records WHERE actor_id LIKE $1)
     )::int AS count`,
    [`${prefix}%`],
  )).rows[0].count;
  return actionUnique && idempotencyUnique && actionCheck && idempotencyCheck && taskCheck && planCheck && ruleCheck && foreignKey && residue === 0;
}

async function expectDatabaseError(
  client: PoolClient,
  savepoint: string,
  sql: string,
  values: readonly unknown[],
  code: string,
  constraint: string,
): Promise<boolean> {
  await client.query(`SAVEPOINT ${savepoint}`);
  let matched = false;
  try {
    await client.query(sql, [...values]);
  } catch (error) {
    matched = Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code &&
      "constraint" in error &&
      error.constraint === constraint,
    );
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  return matched;
}

async function verifyPlaintextRejection(runtimeUrl: string): Promise<{ rejected: boolean; sslSpecific: boolean }> {
  const plaintext = new URL(runtimeUrl);
  plaintext.searchParams.set("sslmode", "disable");
  plaintext.searchParams.delete("uselibpqcompat");
  const pool = new Pool({ connectionString: plaintext.toString(), max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const client = await pool.connect();
    client.release();
    return { rejected: false, sslSpecific: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { rejected: true, sslSpecific: /ssl|tls|pg_hba|encryption/i.test(message) };
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main().catch((error: unknown) => {
    const rawCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const code = /^[A-Z0-9_]{1,32}$/iu.test(rawCode) ? rawCode : "verification_failed";
    process.stderr.write(`Database verification failed safely (${code}); no credential was printed.\n`);
    process.exitCode = 1;
  });
}
