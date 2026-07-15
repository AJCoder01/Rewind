import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { requireDatabaseUrl, type StringEnvironment } from "@/lib/db/config";
import { applyFoundationMigration } from "@/lib/db/migrate";
import { safeMigrationFailureMessage } from "@/lib/db/migration-output";
import { FOUNDATION_MIGRATION_ID } from "@/lib/db/schema";

const ephemeralDatabaseName = "rewind_ci";
const ephemeralDatabaseUser = "postgres";
const ephemeralDatabasePassword = "rewind-ci-only";
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Accept only the fixed disposable CI service URL. This guard deliberately
 * runs before Pool construction so this helper cannot mutate a developer or
 * hosted database when invoked with an accidental migration URL.
 */
export function assertEphemeralMigrationUrl(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Ephemeral migration requires a valid disposable PostgreSQL URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !loopbackHosts.has(parsed.hostname.toLowerCase()) ||
    parsed.pathname !== `/${ephemeralDatabaseName}` ||
    parsed.username !== ephemeralDatabaseUser ||
    parsed.password !== ephemeralDatabasePassword ||
    parsed.searchParams.get("sslmode") !== "disable" ||
    parsed.searchParams.get("uselibpqcompat") !== "true"
  ) {
    throw new Error("Ephemeral migration accepts only the fixed loopback rewind_ci service URL.");
  }
  return databaseUrl;
}

export function requireEphemeralMigrationUrl(environment: StringEnvironment = process.env): string {
  if (environment.CI !== "true") throw new Error("Ephemeral migration is CI-only and requires CI=true.");
  return assertEphemeralMigrationUrl(requireDatabaseUrl("DATABASE_MIGRATION_URL", environment));
}

export async function verifyEphemeralMigration(databaseUrl: string): Promise<readonly ["applied" | "already_applied", "applied" | "already_applied"]> {
  const sql = await readFile(new URL("../db/migrations/0001_phase0_foundation.sql", import.meta.url), "utf8");
  const pool = new Pool({ connectionString: assertEphemeralMigrationUrl(databaseUrl), max: 1, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
  try {
    const first = await applyFoundationMigration(pool, sql);
    const second = await applyFoundationMigration(pool, sql);
    if (first !== "applied" || second !== "already_applied") {
      throw new Error(`Ephemeral migration did not prove apply/replay for ${FOUNDATION_MIGRATION_ID}.`);
    }
    return [first, second];
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const databaseUrl = requireEphemeralMigrationUrl();
    const [first, second] = await verifyEphemeralMigration(databaseUrl);
    process.stdout.write(`${JSON.stringify({ status: "ok", migrationId: FOUNDATION_MIGRATION_ID, first, second })}\n`);
  } catch (error) {
    process.stderr.write(`${safeMigrationFailureMessage(error)}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) void main();
