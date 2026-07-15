import { describe, expect, it } from "vitest";
import {
  GOLDEN_CONTRACT_FIXTURE_VERSION,
  GOLDEN_ERROR_FIXTURES,
  GOLDEN_PREVIEW_VIEW,
  GOLDEN_RESET_PLAN,
  GOLDEN_RESET_SUCCESS,
  GOLDEN_RULE_ACTIVE,
  GOLDEN_RULE_PROPOSED,
  GOLDEN_SUCCESS_FIXTURES,
  GOLDEN_TASK_STATE_FIXTURES,
  GOLDEN_TASK_STATUS_ORDER,
  GoldenPreventionRuleSchema,
  GoldenResetPlanSchema,
  GoldenResetCompleteResponseSchema,
  GoldenTaskStateFixtureSchema,
} from "@/tests/fixtures/contracts/golden";
import { ErrorCodeSchema, TaskStatusSchema } from "@/lib/contracts/v1";

describe("golden contract fixtures", () => {
  it("covers every canonical task read-model state with deterministic IDs", () => {
    expect(GOLDEN_CONTRACT_FIXTURE_VERSION).toBe("golden-contracts.v1");
    expect(GOLDEN_TASK_STATUS_ORDER).toEqual(TaskStatusSchema.options);
    expect(GOLDEN_TASK_STATE_FIXTURES.map((fixture) => fixture.state)).toEqual(TaskStatusSchema.options);
    for (const fixture of GOLDEN_TASK_STATE_FIXTURES) {
      expect(GoldenTaskStateFixtureSchema.safeParse(fixture).success).toBe(true);
      expect(fixture.view.worldPrId).toBe("wpr_golden_s016");
      expect(fixture.view.createdAt).toBe("2026-07-15T10:00:00.000Z");
    }
    expect(GOLDEN_TASK_STATE_FIXTURES.find((fixture) => fixture.state === "clarification_required")?.view.activePlan).toBeUndefined();
    expect(GOLDEN_TASK_STATE_FIXTURES.find((fixture) => fixture.state === "preview_ready")?.view.activePlan).toBeDefined();
  });

  it("freezes strict success and error envelopes without exposing real data", () => {
    expect(GOLDEN_PREVIEW_VIEW.activePlan?.pointer.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(GOLDEN_SUCCESS_FIXTURES).toHaveLength(2);
    expect(GOLDEN_ERROR_FIXTURES).toHaveLength(ErrorCodeSchema.options.length);
    expect(GOLDEN_ERROR_FIXTURES.map((fixture) => fixture.error.code)).toEqual(ErrorCodeSchema.options);
    expect(GOLDEN_ERROR_FIXTURES.every((fixture) => fixture.requestId.startsWith("req_error_"))).toBe(true);
  });

  it("covers the rule and reset states with strict, separately reviewable fixtures", () => {
    expect(GoldenPreventionRuleSchema.safeParse(GOLDEN_RULE_PROPOSED).success).toBe(true);
    expect(GOLDEN_RULE_PROPOSED.status).toBe("proposed");
    expect(GOLDEN_RULE_ACTIVE.status).toBe("active");
    expect(GoldenResetPlanSchema.safeParse(GOLDEN_RESET_PLAN).success).toBe(true);
    expect(GoldenResetCompleteResponseSchema.safeParse(GOLDEN_RESET_SUCCESS).success).toBe(true);
    expect(GOLDEN_RESET_SUCCESS.sentMailDeleted).toBe(false);
  });

  it("rejects unknown fields at the fixture boundaries", () => {
    expect(GoldenTaskStateFixtureSchema.safeParse({ ...GOLDEN_TASK_STATE_FIXTURES[0], unexpected: true }).success).toBe(false);
    expect(GoldenPreventionRuleSchema.safeParse({ ...GOLDEN_RULE_ACTIVE, unexpected: true }).success).toBe(false);
    expect(GoldenResetPlanSchema.safeParse({ ...GOLDEN_RESET_PLAN, unexpected: true }).success).toBe(false);
    expect(GoldenResetCompleteResponseSchema.safeParse({ ...GOLDEN_RESET_SUCCESS, unexpected: true }).success).toBe(false);
  });
});
