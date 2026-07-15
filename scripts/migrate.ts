import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { loadPrivateLocalEnvironment, requireDatabaseUrl } from "@/lib/db/config";
import { applyFoundationMigration } from "@/lib/db/migrate";
import { safeMigrationFailureMessage } from "@/lib/db/migration-output";

async function main(): Promise<void> {
  loadPrivateLocalEnvironment();
  const databaseUrl = requireDatabaseUrl("DATABASE_MIGRATION_URL");
  const sql = await readFile(new URL("../db/migrations/0001_phase0_foundation.sql", import.meta.url), "utf8");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await applyFoundationMigration(pool, sql);
    console.log(
      result === "applied"
        ? "Applied 0001_phase0_foundation.sql atomically"
        : "Verified 0001_phase0_foundation.sql was already applied with the reviewed checksum",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${safeMigrationFailureMessage(error)}\n`);
  process.exitCode = 1;
});
