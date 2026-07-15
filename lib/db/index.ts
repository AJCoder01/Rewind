import { Pool } from "pg";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { PostgresWorldPrStore } from "@/lib/db/postgres-store";
import { StorageNotConfiguredError, type WorldPrStore } from "@/lib/db/store";
import { requireDatabaseUrl } from "@/lib/db/config";

let postgresStore: PostgresWorldPrStore | undefined;

export function getWorldPrStore(): WorldPrStore {
  if (process.env.REWIND_STORAGE_MODE === "memory_fixture" && process.env.NODE_ENV !== "production") return memoryFixtureStore;
  if (!process.env.DATABASE_URL) throw new StorageNotConfiguredError();
  postgresStore ??= new PostgresWorldPrStore(new Pool({ connectionString: requireDatabaseUrl("DATABASE_URL") }));
  return postgresStore;
}
