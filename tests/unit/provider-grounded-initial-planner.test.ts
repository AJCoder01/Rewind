import { describe, expect, it } from "vitest";
import { FakeCalendarPort } from "@/lib/adapters/calendar";
import { FakeModelPort } from "@/lib/ai/model";
import { MemoryOAuthStore } from "@/lib/db/oauth-store";
import { ACCOUNT_BRIEF_CONTENT_FIXTURE, ACCOUNT_BRIEF_TITLE } from "@/lib/domain/account-brief";
import { buildControlledCalendarSeeds } from "@/lib/domain/calendar-demo";
import { sha256Text } from "@/lib/domain/digest";
import { createProviderGroundedInitialPlanner } from "@/lib/services/provider-grounded-initial-planner";

const environment = {
  NODE_ENV: "test",
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://rewind_app:database-secret@localhost:5432/rewind",
  REWIND_STORAGE_MODE: "postgres",
  REWIND_SESSION_SECRET: "session-secret-012345678901234567890123",
  REWIND_DASHBOARD_PASSCODE: "dashboard-passcode-1234",
  MCP_BACKEND_TOKEN: "mcp-token-01234567890123456789012345",
  OPENAI_API_KEY: "sk-project-key-012345678901234",
  OPENAI_MODEL: "gpt-5.6-sol",
  GOOGLE_CLIENT_ID: "1234567890-rewind.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-rewind-client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/api/v1/oauth/google/callback",
  REWIND_TOKEN_ENCRYPTION_KEY: "encryption-key-012345678901234567890123",
  REWIND_GOOGLE_EXPECTED_EMAIL: "owner@example.com",
  REWIND_GOOGLE_EXPECTED_SUB: "google-subject-001",
  REWIND_GOOGLE_CALENDAR_ID: "demo-calendar-2026",
  REWIND_RECIPIENT_ALLOWLIST: JSON.stringify({ UK: ["uk-team@example.com"], US: ["us-team@example.com"] }),
  REWIND_DEMO_DATE: "2026-08-20",
} as const;

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

async function calendar() {
  const value = new FakeCalendarPort({ events: [], organizerDigest: sha256Text(environment.REWIND_GOOGLE_EXPECTED_EMAIL) });
  const configuration = {
    calendarId: environment.REWIND_GOOGLE_CALENDAR_ID,
    demoDate: environment.REWIND_DEMO_DATE,
    expectedEmail: environment.REWIND_GOOGLE_EXPECTED_EMAIL,
    recipients: { UK: ["uk-team@example.com"] as [string], US: ["us-team@example.com"] as [string] },
  };
  for (const seed of buildControlledCalendarSeeds(configuration)) await value.createControlledEvent(seed);
  return value;
}

describe("provider-grounded initial planner", () => {
  it("persists live Calendar identities and bounded model metadata instead of fixture targets", async () => {
    const planner = createProviderGroundedInitialPlanner({
      oauthStore: new MemoryOAuthStore(),
      environment,
      calendar: await calendar(),
      model: new FakeModelPort({ outputs: { initial: proposal } }),
    });
    const resolution = await planner.resolveCandidates({ request: "controlled request", now: new Date("2026-07-17T00:00:00.000Z") });
    const expanded = await planner.expandPlan({
      request: "controlled request",
      taskId: "wpr_provider_planner_0001",
      planId: "plan_provider_planner_0001",
      runId: "run_provider_planner_0001",
      version: 1,
      resolution,
      now: new Date("2026-07-17T00:00:00.000Z"),
    });
    expect(expanded.planPayload.actions[1].target).toMatchObject({ calendarId: environment.REWIND_GOOGLE_CALENDAR_ID });
    expect(expanded.planPayload.actions[1].target.providerEventId).not.toContain("fixture");
    expect(expanded.planPayload.actions[2].desired.to).toEqual(["uk-team@example.com"]);
    expect(expanded.planPayload.actions[0].desired.content).toBe(ACCOUNT_BRIEF_CONTENT_FIXTURE);
  });

  it("fails closed when model-proposed brief content diverges from the canonical source", async () => {
    const planner = createProviderGroundedInitialPlanner({
      oauthStore: new MemoryOAuthStore(),
      environment,
      calendar: await calendar(),
      model: new FakeModelPort({ outputs: { initial: { ...proposal, accountBrief: { ...proposal.accountBrief, content: "Injected region-specific content" } } } }),
    });
    const resolution = await planner.resolveCandidates({ request: "controlled request", now: new Date("2026-07-17T00:00:00.000Z") });
    await expect(planner.expandPlan({
      request: "controlled request",
      taskId: "wpr_provider_planner_0002",
      planId: "plan_provider_planner_0002",
      runId: "run_provider_planner_0002",
      version: 1,
      resolution,
      now: new Date("2026-07-17T00:00:00.000Z"),
    })).rejects.toMatchObject({ name: "ModelSafetyError" });
  });
});
