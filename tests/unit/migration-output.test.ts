import { describe, expect, it } from "vitest";
import { safeMigrationFailureMessage } from "@/lib/db/migration-output";

describe("migration command output", () => {
  it("never includes a provider error or credential-like input", () => {
    const sensitive = "provider detail for private-host.example with secret-value";
    const output = safeMigrationFailureMessage(new Error(sensitive));

    expect(output).toBe("Database migration failed safely; no credential was printed.");
    expect(output).not.toContain(sensitive);
    expect(output).not.toContain("private-host");
  });
});
