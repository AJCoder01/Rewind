import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { requireDatabaseUrl } from "@/lib/db/config";
import { applyFoundationMigration } from "@/lib/db/migrate";
import { safeMigrationFailureMessage } from "@/lib/db/migration-output";
import { FOUNDATION_MIGRATION_ID } from "@/lib/db/schema";

export async function verifyEphemeralMigration(databaseUrl: string): Promise<readonly ["applied" | "already_applied", "applied" | "already_applied"]> {
  const sql = await readFile(new URL("../db/migrations/0001_phase0_foundation.sql", import.meta.url), "utf8");
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
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
    const databaseUrl = requireDatabaseUrl("DATABASE_MIGRATION_URL");
    const [first, second] = await verifyEphemeralMigration(databaseUrl);
    process.stdout.write(`${JSON.stringify({ status: "ok", migrationId: FOUNDATION_MIGRATION_ID, first, second })}\n`);
  } catch (error) {
    process.stderr.write(`${safeMigrationFailureMessage(error)}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) void main();
