import { describe, expect, it } from "vitest";
import {
  ApiErrorResponseSchema,
  CreateWorldPrResponseSchema,
  McpWorldPrStatusSchema,
  PreventionRuleSchema,
  ResetPlanSchema,
  TaskMutationResponseSchema,
  WorldPrViewSchema,
} from "@/lib/contracts/v1";
import {
  GOLDEN_PREVIEW_VIEW,
  GOLDEN_RESET_PLAN,
  GOLDEN_RULE_ACTIVE,
  GOLDEN_SUCCESS_FIXTURES,
  GOLDEN_TASK_STATE_FIXTURES,
} from "@/tests/fixtures/contracts/golden";

describe("S019 strict G1 lifecycle and boundary contracts", () => {
  it("accepts every frozen lifecycle state and rejects read-model extras", () => {
    for (const fixture of GOLDEN_TASK_STATE_FIXTURES) expect(WorldPrViewSchema.parse(fixture.view).status).toBe(fixture.state);
    const invalid = structuredClone(GOLDEN_PREVIEW_VIEW) as Record<string, unknown>;
    invalid.untrusted = true;
    expect(WorldPrViewSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts replay and clarification create envelopes, including an in-progress replay", () => {
    for (const fixture of GOLDEN_SUCCESS_FIXTURES) expect(CreateWorldPrResponseSchema.parse(fixture)).toEqual(fixture);
    expect(CreateWorldPrResponseSchema.parse({
      worldPrId: "wpr_in_progress",
      status: "analyzing",
      reviewUrl: "https://rewind.example/pr/wpr_in_progress",
      requestId: "req_in_progress",
      replayPending: true,
    }).replayPending).toBe(true);
  });

  it("requires attention metadata and rejects unknown error fields", () => {
    expect(TaskMutationResponseSchema.safeParse({ worldPrId: "wpr_attention", status: "attention_required", requestId: "req_attention" }).success).toBe(false);
    expect(ApiErrorResponseSchema.safeParse({
      error: { code: "scenario_busy", message: "busy", retryable: false, unexpected: "no" },
      requestId: "req_error",
    }).success).toBe(false);
  });

  it("promotes the rule and reset boundaries to shared strict schemas", () => {
    expect(PreventionRuleSchema.parse(GOLDEN_RULE_ACTIVE).status).toBe("active");
    expect(ResetPlanSchema.parse(GOLDEN_RESET_PLAN).sentMailRemains).toBe(true);
    const invalidRule = { ...GOLDEN_RULE_ACTIVE, executableCondition: "free form" };
    expect(PreventionRuleSchema.safeParse(invalidRule).success).toBe(false);
  });

  it("keeps MCP status free of provider payloads and exact mail content", () => {
    const status = McpWorldPrStatusSchema.parse({
      worldPrId: GOLDEN_PREVIEW_VIEW.worldPrId,
      status: GOLDEN_PREVIEW_VIEW.status,
      reviewUrl: "https://rewind.example/pr/wpr_golden_s016",
    });
    expect(status).not.toHaveProperty("activePlan");
    expect(status).not.toHaveProperty("recipients");
  });

  it("rejects impossible terminal run state and unsafe MCP status metadata", () => {
    const impossibleFailed = { ...GOLDEN_PREVIEW_VIEW, status: "failed" };
    expect(WorldPrViewSchema.safeParse(impossibleFailed).success).toBe(false);
    expect(McpWorldPrStatusSchema.safeParse({
      worldPrId: GOLDEN_PREVIEW_VIEW.worldPrId,
      status: "clarification_required",
      reviewUrl: "https://rewind.example/pr/wpr_golden_s016",
    }).success).toBe(false);
    expect(McpWorldPrStatusSchema.safeParse({
      worldPrId: GOLDEN_PREVIEW_VIEW.worldPrId,
      status: "preview_ready",
      reviewUrl: "https://rewind.example/pr/wpr_golden_s016",
      attention: { stage: "initial", kind: "provider_conflict" },
    }).success).toBe(false);
  });
});
