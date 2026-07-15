import { describe, expect, it } from "vitest";
import { assertEphemeralMigrationUrl, requireEphemeralMigrationUrl } from "@/scripts/verify-ephemeral-migration";

const ephemeralUrl = "postgresql://postgres:rewind-ci-only@127.0.0.1:5432/rewind_ci?sslmode=disable&uselibpqcompat=true";

describe("ephemeral migration guard", () => {
  it("accepts only the fixed loopback CI service URL", () => {
    expect(assertEphemeralMigrationUrl(ephemeralUrl)).toBe(ephemeralUrl);
  });

  it("rejects a remote, differently named, or differently credentialed database before a pool can be created", () => {
    expect(() => assertEphemeralMigrationUrl("postgresql://postgres:rewind-ci-only@db.example.test:5432/rewind_ci?sslmode=disable&uselibpqcompat=true")).toThrow("fixed loopback");
    expect(() => assertEphemeralMigrationUrl("postgresql://postgres:rewind-ci-only@127.0.0.1:5432/rewind?sslmode=disable&uselibpqcompat=true")).toThrow("fixed loopback");
    expect(() => assertEphemeralMigrationUrl("postgresql://rewind_app:private-value@127.0.0.1:5432/rewind_ci?sslmode=disable&uselibpqcompat=true")).toThrow("fixed loopback");
  });

  it("requires CI=true before reading the disposable migration URL", () => {
    expect(() => requireEphemeralMigrationUrl({ DATABASE_MIGRATION_URL: ephemeralUrl })).toThrow("CI=true");
    expect(requireEphemeralMigrationUrl({ CI: "true", DATABASE_MIGRATION_URL: ephemeralUrl })).toBe(ephemeralUrl);
  });
});
