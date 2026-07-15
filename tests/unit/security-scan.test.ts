import { describe, expect, it } from "vitest";
import { scanHistoricalText, scanText, scanTrackedFileName } from "@/scripts/security-scan";
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
    expect(scanText("docs/setup.md", "postgresql://user:fixture@POOLER_HOST:5432/db")).toEqual([]);
    expect(scanText("docs/setup.md", "postgresql://user:fixture@db.PROJECT_REF.supabase.co:5432/db")).toEqual([]);
  });

  it("flags remote connection URLs and tracked private-file names", () => {
    const remoteFixture = ["postgresql://unit:fixture@", "remote.internal:5432/db"].join("");
    expect(scanText("notes.md", remoteFixture)).toEqual([
      { file: "notes.md", rule: "remote-connection-url" },
    ]);
    expect(scanTrackedFileName(".env.local")).toEqual([{ file: ".env.local", rule: "private-environment-file" }]);
    expect(scanTrackedFileName(".env.example")).toEqual([]);
  });

  it("permits only the documented historical scanner fixture URL", () => {
    const historicalFixture = ["postgresql://user:secret@", "remote.internal:5432/db"].join("");
    expect(scanText("legacy-test.ts", historicalFixture)).toEqual([]);
    const changedHistoricalFixture = ["postgresql://user:fixture@", "remote.internal:5432/db"].join("");
    expect(scanText("legacy-test.ts", changedHistoricalFixture)).toEqual([
      { file: "legacy-test.ts", rule: "remote-connection-url" },
    ]);
  });

  it("does not allow broad placeholder fragments to hide a remote URL", () => {
    const placeholderRemote = ["postgresql://user:fixture@", "pooler_host.", "internal:5432/db"].join("");
    const projectRemote = ["postgresql://user:fixture@", "db.project_ref.", "evil:5432/db"].join("");
    expect(scanText("notes.md", placeholderRemote)).toEqual([
      { file: "notes.md", rule: "remote-connection-url" },
    ]);
    expect(scanText("notes.md", projectRemote)).toEqual([
      { file: "notes.md", rule: "remote-connection-url" },
    ]);
  });

  it("reports historical findings by path and rule without including content", () => {
    const token = ["ghp_", "B".repeat(36)].join("");
    const findings = scanHistoricalText("1234567890abcdef", "deleted-notes.md", `token=${token}`);
    expect(findings).toEqual([{ file: "history/1234567890ab/deleted-notes.md", rule: "github-token" }]);
    expect(JSON.stringify(findings)).not.toContain(token);
  });

  it("proves production rejects the memory fixture mode", () => {
    expect(productionFixtureIsRejected()).toBe(true);
  });
});
