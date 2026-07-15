import { describe, expect, it } from "vitest";
import { scanText, scanTrackedFileName } from "@/scripts/security-scan";
import { productionFixtureIsRejected } from "@/scripts/verify-fake-production";

describe("repository security checks", () => {
  it("detects credential-shaped tokens without exposing their values", () => {
    const token = ["ghp_", "A".repeat(36)].join("");
    const findings = scanText("notes.md", `token=${token}`);
    expect(findings).toEqual([{ file: "notes.md", rule: "github-token" }]);
    expect(JSON.stringify(findings)).not.toContain(token);
  });

  it("allows clearly local or example connection fixtures", () => {
    expect(scanText("tests/fixture.ts", "postgresql://user:fixture@localhost:5432/db")).toEqual([]);
    expect(scanText("docs/example.md", "postgresql://user:fixture@db.example.test:5432/db")).toEqual([]);
  });

  it("flags remote connection URLs and tracked private-file names", () => {
    expect(scanText("notes.md", "postgresql://user:secret@remote.internal:5432/db")).toEqual([
      { file: "notes.md", rule: "remote-connection-url" },
    ]);
    expect(scanTrackedFileName(".env.local")).toEqual([{ file: ".env.local", rule: "private-environment-file" }]);
    expect(scanTrackedFileName(".env.example")).toEqual([]);
  });

  it("proves production rejects the memory fixture mode", () => {
    expect(productionFixtureIsRejected()).toBe(true);
  });
});
