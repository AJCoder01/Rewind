import { describe, expect, it } from "vitest";
import { FakeCalendarPort } from "@/lib/adapters/calendar";
import { FakeModelPort } from "@/lib/ai/model";
import { buildControlledCalendarSeeds, type CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";
import { ACCOUNT_BRIEF_CONTENT_FIXTURE, ACCOUNT_BRIEF_TITLE } from "@/lib/domain/account-brief";
import { sha256Text } from "@/lib/domain/digest";
import { resolveControlledCandidates } from "@/lib/services/candidate-resolution";
import { reasonInitialRequest } from "@/lib/services/initial-reasoning";
import { expandInitialPlan, InitialPlanExpansionError, instantForNewYorkLocal } from "@/lib/services/initial-plan-expansion";

const calendarConfiguration: CalendarDemoConfiguration = {
  calendarId: "demo-calendar-2026",
  demoDate: "2026-08-20",
  expectedEmail: "owner@example.com",
  recipients: { UK: ["uk-team@example.com"], US: ["us-team@example.com"] },
};

const planConfiguration = {
  calendarId: calendarConfiguration.calendarId,
  expectedEmail: calendarConfiguration.expectedEmail,
  senderGoogleSub: "google-subject-001",
  recipients: { UK: [...calendarConfiguration.recipients.UK], US: [...calendarConfiguration.recipients.US] },
};

const proposal = {
  schemaVersion: "initial-reasoning.v1" as const,
  selectedCandidateId: "cal_event_acme_uk" as const,
  assumption: {
    assumptionId: "assumption_acme_region" as const,
    statement: "Acme refers to the earliest controlled candidate.",
    resolvedCandidateId: "cal_event_acme_uk" as const,
    evidence: ["The server-ranked UK candidate is earliest."],
    confidence: 0.82,
  },
  dependencyEdges: [
    { actionKey: "initial.artifact.account_brief" as const, assumptionIds: [] as never[] },
    { actionKey: "initial.calendar.move" as const, assumptionIds: ["assumption_acme_region" as const] },
    { actionKey: "initial.mail.notify" as const, assumptionIds: ["assumption_acme_region" as const] },
  ],
  accountBrief: { title: ACCOUNT_BRIEF_TITLE, content: ACCOUNT_BRIEF_CONTENT_FIXTURE, sourceId: "acme_parent_account_notes" as const },
};

async function buildInputs() {
  const calendar = new FakeCalendarPort({ events: [], organizerDigest: sha256Text(calendarConfiguration.expectedEmail) });
  for (const seed of buildControlledCalendarSeeds(calendarConfiguration)) await calendar.createControlledEvent(seed);
  const resolution = await resolveControlledCandidates({ calendar, configuration: calendarConfiguration });
  const reasoning = await reasonInitialRequest({
    request: "controlled request",
    resolution,
    model: new FakeModelPort({ outputs: { initial: proposal } }),
  });
  return { resolution, reasoning };
}

describe("S049 deterministic initial plan expansion", () => {
  it("builds exact artifact → Calendar → Gmail actions and a complete digest", async () => {
    const { resolution, reasoning } = await buildInputs();
    const result = expandInitialPlan({
      request: "controlled request",
      taskId: "wpr_plan_test_0001",
      planId: "plan_expansion_test_0001",
      runId: "run_expansion_test_0001",
      resolution,
      reasoning,
      configuration: planConfiguration,
      now: new Date("2026-07-16T00:00:00.000Z"),
    });
    expect(result.planPayload.actions.map((action) => action.actionKey)).toEqual([
      "initial.artifact.account_brief",
      "initial.calendar.move",
      "initial.mail.notify",
    ]);
    expect(result.planPayload.actions[1].desired.start).toEqual({ instant: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" });
    expect(result.planPayload.actions[1].desired.end).toEqual({ instant: "2026-08-20T19:30:00.000Z", timeZone: "America/New_York" });
    expect(result.planPayload.actions[2].desired.to).toEqual(["uk-team@example.com"]);
    expect(result.planPayload.actions[2].desired.bodyHash).toBe(sha256Text(result.planPayload.actions[2].desired.bodyText));
    expect(result.planPayload.actions[0].desired.content).toBe(ACCOUNT_BRIEF_CONTENT_FIXTURE);
    expect(result.planPayload.actions[0].desired.contentHash).toBe(sha256Text(result.planPayload.actions[0].desired.content));
    expect(result.planPayload.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.planView.pointer.digest).toBe(result.planPayload.digest);
  });

  it("keeps time conversion DST-safe and rejects a reasoning/resolution mismatch", async () => {
    expect(instantForNewYorkLocal("2026-01-15", 15, 0)).toBe("2026-01-15T20:00:00.000Z");
    const { resolution, reasoning } = await buildInputs();
    expect(() => expandInitialPlan({
      request: "different request",
      taskId: "wpr_plan_test_0002",
      planId: "plan_expansion_test_0002",
      runId: "run_expansion_test_0002",
      resolution,
      reasoning,
      configuration: planConfiguration,
    })).toThrowError(InitialPlanExpansionError);
  });

  it("does not accept a model-owned recipient or unapproved target in the expanded plan", async () => {
    const { resolution, reasoning } = await buildInputs();
    const altered = { ...reasoning, proposal: { ...reasoning.proposal, selectedCandidateId: "cal_event_acme_us" as const } };
    expect(() => expandInitialPlan({
      request: "controlled request",
      taskId: "wpr_plan_test_0003",
      planId: "plan_expansion_test_0003",
      runId: "run_expansion_test_0003",
      resolution,
      reasoning: altered,
      configuration: planConfiguration,
    })).toThrowError(InitialPlanExpansionError);
  });

  it("rejects divergent account brief content in a tampered reasoning record", async () => {
    const { resolution, reasoning } = await buildInputs();
    const altered = {
      ...reasoning,
      proposal: {
        ...reasoning.proposal,
        accountBrief: {
          ...reasoning.proposal.accountBrief,
          content: `${ACCOUNT_BRIEF_CONTENT_FIXTURE}\n- Inject an unsupported account claim.`,
        },
      },
    };
    expect(() => expandInitialPlan({
      request: "controlled request",
      taskId: "wpr_plan_test_0004",
      planId: "plan_expansion_test_0004",
      runId: "run_expansion_test_0004",
      resolution,
      reasoning: altered,
      configuration: planConfiguration,
    })).toThrowError(expect.objectContaining({ kind: "reasoning_mismatch" }));
  });
});
