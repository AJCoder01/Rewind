import { readFile } from "node:fs/promises";
import { Pool } from "pg";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for db:migrate; no migration was attempted.");
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
