import { describe, expect, it } from "vitest";
import { CreateWorldPrRequestSchema, WorldPrViewSchema } from "@/lib/contracts/v1";
import { buildFixtureWorldPr } from "@/lib/domain/fixture-world-pr";

describe("contracts.v1", () => {
  it("accepts the controlled create request", () => {
    expect(CreateWorldPrRequestSchema.parse({ request: "Move the Acme renewal meeting and email the attendees." })).toEqual({ request: "Move the Acme renewal meeting and email the attendees." });
  });

  it("rejects unknown request properties", () => {
    expect(CreateWorldPrRequestSchema.safeParse({ request: "valid", extra: true }).success).toBe(false);
  });

  it("rejects an action list with the wrong fixed execution shape", () => {
    const invalid = structuredClone(buildFixtureWorldPr("fixture request")) as unknown as {
      activePlan: { actions: unknown[] };
    };
    invalid.activePlan.actions[1] = invalid.activePlan.actions[0];
    expect(WorldPrViewSchema.safeParse(invalid).success).toBe(false);
  });

  it("requires preview-ready views to contain exactly one active plan", () => {
    const fixture = buildFixtureWorldPr("fixture request");
    const invalid = { ...fixture, activePlan: undefined };
    expect(WorldPrViewSchema.safeParse(invalid).success).toBe(false);
  });
});
