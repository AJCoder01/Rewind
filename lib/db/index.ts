import { Pool } from "pg";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { MemoryOAuthStore, PostgresOAuthStore, type OAuthStore } from "@/lib/db/oauth-store";
import { PostgresWorldPrStore } from "@/lib/db/postgres-store";
import { MemoryExecutionPersistenceStore, PostgresExecutionPersistenceStore, type ExecutionPersistenceStore } from "@/lib/db/execution-store";
import { FakeProviderConfigurationError, StorageNotConfiguredError, type WorldPrStore } from "@/lib/db/store";
import { requireDatabaseUrl } from "@/lib/db/config";

let postgresStore: PostgresWorldPrStore | undefined;
let postgresOAuthStore: PostgresOAuthStore | undefined;
let postgresExecutionStore: PostgresExecutionPersistenceStore | undefined;
export const memoryOAuthStore = new MemoryOAuthStore();
export const memoryExecutionStore = new MemoryExecutionPersistenceStore();

export function getWorldPrStore(): WorldPrStore {
  const environmentMode = process.env.NODE_ENV ?? "development";
  if (process.env.REWIND_STORAGE_MODE === "memory_fixture") {
    if (environmentMode === "production") throw new FakeProviderConfigurationError();
    return memoryFixtureStore;
  }
  if (!process.env.DATABASE_URL) throw new StorageNotConfiguredError();
  postgresStore ??= new PostgresWorldPrStore(new Pool({ connectionString: requireDatabaseUrl("DATABASE_URL") }));
  return postgresStore;
}

export function getOAuthStore(): OAuthStore {
  const environmentMode = process.env.NODE_ENV ?? "development";
  if (process.env.REWIND_STORAGE_MODE === "memory_fixture") {
    if (environmentMode === "production") throw new FakeProviderConfigurationError();
    return memoryOAuthStore;
  }
  if (!process.env.DATABASE_URL) throw new StorageNotConfiguredError();
  postgresOAuthStore ??= new PostgresOAuthStore(new Pool({ connectionString: requireDatabaseUrl("DATABASE_URL") }));
  return postgresOAuthStore;
}

export function getExecutionPersistenceStore(): ExecutionPersistenceStore {
  const environmentMode = process.env.NODE_ENV ?? "development";
  if (process.env.REWIND_STORAGE_MODE === "memory_fixture") {
    if (environmentMode === "production") throw new FakeProviderConfigurationError();
    return memoryExecutionStore;
  }
  if (!process.env.DATABASE_URL) throw new StorageNotConfiguredError();
  postgresExecutionStore ??= new PostgresExecutionPersistenceStore(new Pool({ connectionString: requireDatabaseUrl("DATABASE_URL") }));
  return postgresExecutionStore;
}
