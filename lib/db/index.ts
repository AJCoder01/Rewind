import { Pool } from "pg";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { MemoryOAuthStore, PostgresOAuthStore, type OAuthStore } from "@/lib/db/oauth-store";
import { PostgresWorldPrStore } from "@/lib/db/postgres-store";
import { MemoryExecutionPersistenceStore, PostgresExecutionPersistenceStore, type ExecutionPersistenceStore } from "@/lib/db/execution-store";
import { FakeProviderConfigurationError, StorageNotConfiguredError, type WorldPrStore } from "@/lib/db/store";
import { requireDatabaseUrl } from "@/lib/db/config";
import { createProviderGroundedInitialPlanner } from "@/lib/services/provider-grounded-initial-planner";

let postgresPool: Pool | undefined;
let postgresStore: PostgresWorldPrStore | undefined;
let postgresOAuthStore: PostgresOAuthStore | undefined;
let postgresExecutionStore: PostgresExecutionPersistenceStore | undefined;
export const memoryOAuthStore = new MemoryOAuthStore();
export const memoryExecutionStore = new MemoryExecutionPersistenceStore();

export function getPostgresPool(): Pool {
  if (process.env.REWIND_STORAGE_MODE === "memory_fixture") throw new StorageNotConfiguredError();
  if (!process.env.DATABASE_URL) throw new StorageNotConfiguredError();
  postgresPool ??= new Pool({ connectionString: requireDatabaseUrl("DATABASE_URL") });
  return postgresPool;
}

export function getWorldPrStore(): WorldPrStore {
  const environmentMode = process.env.NODE_ENV ?? "development";
  if (process.env.REWIND_STORAGE_MODE === "memory_fixture") {
    if (environmentMode === "production") throw new FakeProviderConfigurationError();
    return memoryFixtureStore;
  }
  const pool = getPostgresPool();
  postgresOAuthStore ??= new PostgresOAuthStore(pool);
  postgresStore ??= new PostgresWorldPrStore(
    pool,
    createProviderGroundedInitialPlanner({ oauthStore: postgresOAuthStore }),
  );
  return postgresStore;
}

export function getOAuthStore(): OAuthStore {
  const environmentMode = process.env.NODE_ENV ?? "development";
  if (process.env.REWIND_STORAGE_MODE === "memory_fixture") {
    if (environmentMode === "production") throw new FakeProviderConfigurationError();
    return memoryOAuthStore;
  }
  postgresOAuthStore ??= new PostgresOAuthStore(getPostgresPool());
  return postgresOAuthStore;
}

export function getExecutionPersistenceStore(): ExecutionPersistenceStore {
  const environmentMode = process.env.NODE_ENV ?? "development";
  if (process.env.REWIND_STORAGE_MODE === "memory_fixture") {
    if (environmentMode === "production") throw new FakeProviderConfigurationError();
    return memoryExecutionStore;
  }
  postgresExecutionStore ??= new PostgresExecutionPersistenceStore(getPostgresPool());
  return postgresExecutionStore;
}
