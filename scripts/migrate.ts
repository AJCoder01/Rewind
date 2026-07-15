import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { loadPrivateLocalEnvironment, requireDatabaseUrl } from "@/lib/db/config";

async function main(): Promise<void> {
  loadPrivateLocalEnvironment();
  const databaseUrl = requireDatabaseUrl("DATABASE_MIGRATION_URL");
  const sql = await readFile(new URL("../db/migrations/0001_phase0_foundation.sql", import.meta.url), "utf8");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(sql);
    console.log("Applied 0001_phase0_foundation.sql");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "The migration failed before completion.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
