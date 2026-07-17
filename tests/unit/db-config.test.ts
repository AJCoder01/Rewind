import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrivateLocalEnvironment, requireDatabaseUrl } from "@/lib/db/config";

describe("database connection configuration", () => {
  it("loads standalone command environments with the same precedence as Next", () => {
    const directory = mkdtempSync(join(tmpdir(), "rewind-env-precedence-"));
    const keys = ["NODE_ENV", "REWIND_ENV_TEST_FILE", "REWIND_ENV_TEST_SHELL", "__NEXT_PROCESSED_ENV"] as const;
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      writeFileSync(join(directory, ".env"), "REWIND_ENV_TEST_FILE=base\nREWIND_ENV_TEST_SHELL=base\n");
      writeFileSync(join(directory, ".env.development"), "REWIND_ENV_TEST_FILE=development\n");
      writeFileSync(join(directory, ".env.local"), "REWIND_ENV_TEST_FILE=local\n");
      writeFileSync(join(directory, ".env.development.local"), "REWIND_ENV_TEST_FILE=development-local\nREWIND_ENV_TEST_SHELL=file\n");
      Object.assign(process.env, { NODE_ENV: "development" });
      delete process.env.REWIND_ENV_TEST_FILE;
      process.env.REWIND_ENV_TEST_SHELL = "shell";
      delete process.env.__NEXT_PROCESSED_ENV;

      expect(loadPrivateLocalEnvironment(directory)).toBe(".env.development.local");
      expect(process.env.REWIND_ENV_TEST_FILE).toBe("development-local");
      expect(process.env.REWIND_ENV_TEST_SHELL).toBe("shell");
    } finally {
      for (const key of keys) {
        const value = original[key];
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else Object.assign(process.env, { [key]: value });
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires a distinct migration URL instead of falling back to the runtime URL", () => {
    const environment = {
      DATABASE_URL: "postgresql://rewind_app:secret@localhost:5432/rewind",
    };
    expect(() => requireDatabaseUrl("DATABASE_MIGRATION_URL", environment)).toThrow("DATABASE_MIGRATION_URL is required");
  });

  it("accepts local PostgreSQL without TLS for isolated automated tests", () => {
    const value = "postgresql://rewind_app:secret@127.0.0.1:5432/rewind";
    expect(requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: value })).toBe(value);
  });

  it("requires TLS for every non-local database URL", () => {
    const insecure = "postgresql://rewind_app:secret@db.example.test:6543/rewind";
    const secure = `${insecure}?sslmode=require&uselibpqcompat=true`;
    const missingCompatibility = `${insecure}?sslmode=require`;
    const duplicateOverride = `${insecure}?sslmode=require&sslmode=disable&uselibpqcompat=true`;
    expect(() => requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: insecure })).toThrow("must require TLS");
    expect(() => requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: missingCompatibility })).toThrow("uselibpqcompat=true");
    expect(() => requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: duplicateOverride })).toThrow("must require TLS");
    expect(requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: secure })).toBe(secure);
  });

  it("rejects malformed or incomplete PostgreSQL URLs before connecting", () => {
    expect(() => requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: "https://example.test/database" })).toThrow("postgres or postgresql scheme");
    expect(() => requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: "postgresql://localhost/rewind" })).toThrow("host, username, password, and database name");
  });
});
