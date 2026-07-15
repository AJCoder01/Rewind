import { describe, expect, it } from "vitest";
import { CreateWorldPrRequestSchema, CreateWorldPrResponseSchema, InitialPlanPayloadSchema, WorldPrViewSchema } from "@/lib/contracts/v1";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { buildFixtureWorldPr, buildFixtureWorldPrRecord } from "@/lib/domain/fixture-world-pr";

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

  it("keeps clarification intake lock-free and accepts its explicit create response branch", () => {
    const preview = buildFixtureWorldPr("fixture request");
    const clarification = {
      ...preview,
      runId: undefined,
      status: "clarification_required" as const,
      activePlan: undefined,
      clarification: {
        question: "Which controlled candidate did you mean?",
        candidates: [
          { candidateId: "cal_event_acme_uk", label: "Acme UK renewal" },
          { candidateId: "cal_event_acme_us", label: "Acme US renewal" },
        ],
      },
    };
    expect(WorldPrViewSchema.safeParse(clarification).success).toBe(true);
    expect(CreateWorldPrResponseSchema.safeParse({
      worldPrId: "wpr_clarify_s016",
      status: "clarification_required",
      reviewUrl: "https://rewind.example/pr/wpr_clarify_s016",
      clarification: {
        question: "Which controlled candidate did you mean?",
        candidates: [
          { candidateId: "cal_event_acme_uk", label: "Acme UK renewal" },
          { candidateId: "cal_event_acme_us", label: "Acme US renewal" },
        ],
      },
      requestId: "req_clarify_s016",
    }).success).toBe(true);
  });

  it("rejects an initial plan in recovery lifecycle states", () => {
    const preview = buildFixtureWorldPr("fixture request");
    expect(WorldPrViewSchema.safeParse({ ...preview, status: "recovery_ready" }).success).toBe(false);
    expect(WorldPrViewSchema.safeParse({ ...preview, status: "cancelled" }).success).toBe(false);
  });

  it("binds the plan digest to the complete canonical payload", () => {
    const { planPayload } = buildFixtureWorldPrRecord("fixture request");
    const tampered = structuredClone(planPayload);
    tampered.request = "tampered request";
    expect(VerifiedInitialPlanPayloadSchema.safeParse(tampered).success).toBe(false);
  });

  it("rejects cross-field candidate and action mismatches", () => {
    const { planPayload } = buildFixtureWorldPrRecord("fixture request");
    const tampered = structuredClone(planPayload);
    tampered.actions[1].target.providerEventId = "fixture-event-us";
    expect(InitialPlanPayloadSchema.safeParse(tampered).success).toBe(false);
  });

  it("rejects duplicate candidate regions in the controlled universe", () => {
    const { planPayload } = buildFixtureWorldPrRecord("fixture request");
    const tampered = structuredClone(planPayload);
    tampered.candidateSet[1].region = "UK";
    expect(InitialPlanPayloadSchema.safeParse(tampered).success).toBe(false);
  });

  it("records complete, explicitly fixture-only model metadata", () => {
    const { planPayload } = buildFixtureWorldPrRecord("fixture request");
    expect(planPayload.modelMetadata).toEqual({
      provider: "fixture",
      model: "fixture-initial.v1",
      promptVersion: "fixture-initial.v1",
      schemaVersion: "initial-reasoning.v1",
      reasoningEffort: "none",
      responseId: "fixture-response",
      source: "fixture",
    });
  });
});
