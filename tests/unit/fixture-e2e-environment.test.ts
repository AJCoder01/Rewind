import { describe, expect, it } from "vitest";
import { parseApplicationEnvironment } from "@/lib/config/environment";
import { FIXTURE_E2E_SERVER_ENVIRONMENT } from "@/scripts/test-e2e";

describe("fixture E2E server environment", () => {
  it("is a complete test-only fixture configuration with no database or provider binding", () => {
    const parsed = parseApplicationEnvironment(FIXTURE_E2E_SERVER_ENVIRONMENT);
    expect(parsed.NODE_ENV).toBe("test");
    expect(parsed.REWIND_STORAGE_MODE).toBe("memory_fixture");
    expect(parsed.DATABASE_URL).toBeUndefined();
    expect(parsed.REWIND_GOOGLE_EXPECTED_SUB).toBeUndefined();
    expect(parsed.REWIND_GOOGLE_CALENDAR_ID).toBeUndefined();
    expect(parsed.GOOGLE_REFRESH_TOKEN_CIPHERTEXT).toBeUndefined();
  });

  it("does not inherit process environment values into the fixture server", () => {
    const keys = Object.keys(FIXTURE_E2E_SERVER_ENVIRONMENT);
    expect(keys).not.toContain("DATABASE_URL");
    expect(keys).not.toContain("DATABASE_MIGRATION_URL");
    expect(keys).not.toContain("GOOGLE_REFRESH_TOKEN_CIPHERTEXT");
    expect(keys).not.toContain("REWIND_GOOGLE_CALENDAR_ID");
  });
});
