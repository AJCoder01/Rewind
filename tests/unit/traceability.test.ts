import { describe, expect, it } from "vitest";
import { ParsedRequirementTraceability, TRACEABILITY_CATALOG_VERSION } from "@/tests/fixtures/traceability/catalog";
import { verifyTraceability } from "@/scripts/verify-traceability";

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
    expect(verifyTraceability()).toEqual({ total: 52, covered: 3, partial: 15, planned: 34 });
  });
});
