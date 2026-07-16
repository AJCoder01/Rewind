import { describe, expect, it } from "vitest";
import { ParsedRequirementTraceability, TRACEABILITY_CATALOG_VERSION } from "@/tests/fixtures/traceability/catalog";
import { verifyTraceability } from "@/scripts/verify-traceability";
import { RequirementTraceSchema } from "@/tests/fixtures/traceability/schema";

describe("executable requirement traceability", () => {
  it("contains every FR, SAFE, and NFR identifier exactly once", () => {
    const ids = ParsedRequirementTraceability.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(52);
    expect(ids).toHaveLength(52);
    expect(ids).toEqual([
      ...Array.from({ length: 32 }, (_, index) => `FR-${String(index + 1).padStart(2, "0")}`),
      ...Array.from({ length: 10 }, (_, index) => `SAFE-${String(index + 1).padStart(2, "0")}`),
      ...Array.from({ length: 10 }, (_, index) => `NFR-${String(index + 1).padStart(2, "0")}`),
    ]);
  });

  it("validates all referenced repository paths and reports honest coverage counts", () => {
    expect(TRACEABILITY_CATALOG_VERSION).toBe("traceability.v1");
    expect(verifyTraceability()).toEqual({ total: 52, covered: 3, partial: 36, planned: 13 });
  });

  it("rejects unknown fixture IDs and paths that could escape the repository", () => {
    const base = ParsedRequirementTraceability.find((entry) => entry.id === "FR-01");
    if (!base) throw new Error("FR-01 fixture is required for this test.");
    expect(RequirementTraceSchema.safeParse({ ...base, fixtureIds: ["unknown-fixture.v1"] }).success).toBe(false);
    expect(RequirementTraceSchema.safeParse({ ...base, codePaths: ["../outside.ts"] }).success).toBe(false);
    expect(RequirementTraceSchema.safeParse({ ...base, codePaths: ["C:\\outside.ts"] }).success).toBe(false);
    expect(RequirementTraceSchema.safeParse({ ...base, codePaths: ["//server/share.ts"] }).success).toBe(false);
  });

  it("fails on duplicate or missing requirement identifiers instead of reporting false coverage", () => {
    expect(() => verifyTraceability([...ParsedRequirementTraceability, ParsedRequirementTraceability[0]])).toThrow("Duplicate requirement trace");
    expect(() => verifyTraceability(ParsedRequirementTraceability.filter((entry) => entry.id !== "NFR-10"))).toThrow("incomplete");
  });
});
