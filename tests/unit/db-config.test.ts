import { describe, expect, it } from "vitest";
import { requireDatabaseUrl } from "@/lib/db/config";

describe("database connection configuration", () => {
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
