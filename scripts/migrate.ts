import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { loadPrivateLocalEnvironment, requireDatabaseUrl } from "@/lib/db/config";
import { applyFoundationMigration } from "@/lib/db/migrate";
import { safeMigrationFailureMessage } from "@/lib/db/migration-output";
import { applyOAuthMigration } from "@/lib/db/oauth-migrate";

async function main(): Promise<void> {
  loadPrivateLocalEnvironment();
  const databaseUrl = requireDatabaseUrl("DATABASE_MIGRATION_URL");
  const foundationSql = await readFile(new URL("../db/migrations/0001_phase0_foundation.sql", import.meta.url), "utf8");
  const oauthSql = await readFile(new URL("../db/migrations/0002_oauth_transaction.sql", import.meta.url), "utf8");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const foundationResult = await applyFoundationMigration(pool, foundationSql);
    const oauthResult = await applyOAuthMigration(pool, oauthSql);
    console.log(`0001_phase0_foundation.sql: ${foundationResult}`);
    console.log(`0002_oauth_transaction.sql: ${oauthResult}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${safeMigrationFailureMessage(error)}\n`);
  process.exitCode = 1;
});
