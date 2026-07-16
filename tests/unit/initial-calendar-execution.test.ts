import { describe, expect, it } from "vitest";
import {
  CalendarProviderError,
  FakeCalendarPort,
  type CalendarPort,
} from "@/lib/adapters/calendar";
import { FakeArtifactPort } from "@/lib/adapters/artifact";
import { type ActionExecutionRecord, type ExecutionPlan } from "@/lib/contracts/execution-persistence";
import { type CalendarConditionalTimeUpdate, type CalendarEventSnapshot } from "@/lib/contracts/provider-ports";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { MemoryExecutionPersistenceStore, ExecutionPersistenceError } from "@/lib/db/execution-store";
import { buildControlledCalendarSeeds, type CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";
import { sha256Text } from "@/lib/domain/digest";
import { ACCOUNT_BRIEF_TITLE } from "@/lib/domain/account-brief";
import { FakeModelPort } from "@/lib/ai/model";
import { resolveControlledCandidates } from "@/lib/services/candidate-resolution";
import { reasonInitialRequest } from "@/lib/services/initial-reasoning";
import { expandInitialPlan } from "@/lib/services/initial-plan-expansion";
import { executeApprovedInitialArtifact } from "@/lib/services/initial-artifact-execution";
import { executeApprovedInitialCalendar, type InitialCalendarExecutionInput } from "@/lib/services/initial-calendar-execution";
import { prepareInitialActionRows } from "@/lib/services/initial-execution";

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
  accountBrief: { title: ACCOUNT_BRIEF_TITLE, content: "Parent-account risks only.", sourceId: "acme_parent_account_notes" as const },
};

const now = "2026-07-16T12:00:00.000Z";

type Setup = {
  store: MemoryExecutionPersistenceStore;
  calendar: FakeCalendarPort;
  plan: ExecutionPlan;
  configuration: CalendarDemoConfiguration;
};

async function createApproved(options: { completeArtifact?: boolean } = {}): Promise<Setup> {
  const calendar = new FakeCalendarPort({ events: [], organizerDigest: sha256Text(calendarConfiguration.expectedEmail) });
  for (const seed of buildControlledCalendarSeeds(calendarConfiguration)) await calendar.createControlledEvent(seed);
  const resolution = await resolveControlledCandidates({ calendar, configuration: calendarConfiguration });
  const reasoning = await reasonInitialRequest({
    request: "controlled request",
    resolution,
    model: new FakeModelPort({ outputs: { initial: proposal } }),
  });
  const expanded = expandInitialPlan({
    request: "controlled request",
    taskId: "wpr_s054_calendar_test_01",
    planId: "plan_s054_calendar_test_01",
    runId: "run_s054_calendar_test_01",
    resolution,
    reasoning,
    configuration: planConfiguration,
    now: new Date(now),
  });
  const plan = {
    planId: expanded.planPayload.planId,
    taskId: expanded.planPayload.taskId,
    kind: "initial" as const,
    version: expanded.planPayload.version,
    schemaVersion: expanded.planPayload.schemaVersion,
    promptVersion: expanded.planPayload.modelMetadata.promptVersion,
    model: expanded.planPayload.modelMetadata.model,
    payload: expanded.planPayload,
    digest: expanded.planPayload.digest,
    createdAt: expanded.createdAt,
  } satisfies ExecutionPlan;
  const store = new MemoryExecutionPersistenceStore();
  await store.createPlan(plan);
  await store.createApproval({
    approvalId: "appr_s054_calendar_test_01",
    planId: plan.planId,
    planVersion: plan.version,
    planDigest: plan.digest,
    actorId: "test:operator",
    approvedAt: now,
  });
  await prepareInitialActionRows(plan, store);
  if (options.completeArtifact !== false) {
    const artifact = await executeApprovedInitialArtifact(
      executionInput(plan),
      { executionStore: store, artifactPort: new FakeArtifactPort({ storedAt: "2026-07-16T12:00:01.000Z" }) },
    );
    expect(artifact.decision).toBe("succeeded");
  }
  return { store, calendar, plan, configuration: calendarConfiguration };
}

function executionInput(plan: ExecutionPlan, overrides: Partial<InitialCalendarExecutionInput> = {}): InitialCalendarExecutionInput {
  return {
    actorId: "test:operator",
    source: "dashboard",
    planId: plan.planId,
    planDigest: plan.digest,
    now,
    leaseUntil: "2026-07-16T12:01:00.000Z",
    ...overrides,
  };
}

function calendarAction(plan: ExecutionPlan) {
  return VerifiedInitialPlanPayloadSchema.parse(plan.payload).actions[1];
}

function instrumentCalendar(
  base: FakeCalendarPort,
  hooks: {
    onUpdate?: (input: CalendarConditionalTimeUpdate) => Promise<void> | void;
    get?: (input: Parameters<CalendarPort["getControlledEvent"]>[0]) => Promise<CalendarEventSnapshot>;
    update?: (input: CalendarConditionalTimeUpdate) => Promise<CalendarEventSnapshot>;
  } = {},
): CalendarPort {
  return {
    listControlledEvents: (input) => base.listControlledEvents(input),
    createControlledEvent: (input) => base.createControlledEvent(input),
    getControlledEvent: hooks.get ?? ((input) => base.getControlledEvent(input)),
    updateStartEnd: async (input) => {
      await hooks.onUpdate?.(input);
      return hooks.update ? hooks.update(input) : base.updateStartEnd(input);
    },
  };
}

describe("S054 exact approved Calendar execution", () => {
  it("persists the exact before-state before a narrow conditional move and verifies the new ETag", async () => {
    const { store, calendar, plan, configuration } = await createApproved();
    const action = calendarAction(plan);
    let updateCalls = 0;
    const observations: { before?: ActionExecutionRecord } = {};
    let observedUpdate: CalendarConditionalTimeUpdate | undefined;
    const port = instrumentCalendar(calendar, {
      onUpdate: async (input) => {
        updateCalls += 1;
        observedUpdate = input;
        const row = (await store.listActions(plan.planId)).find((candidate) => candidate.actionKey === "initial.calendar.move");
        if (row) observations.before = row;
      },
    });

    const result = await executeApprovedInitialCalendar(executionInput(plan), { executionStore: store, calendar: port, configuration });
    expect(result.decision).toBe("succeeded");
    expect(result.record.status).toBe("succeeded");
    expect(updateCalls).toBe(1);
    expect(observedUpdate).toEqual({
      calendarId: action.target.calendarId,
      providerEventId: action.target.providerEventId,
      expectedEtag: action.preconditions.expectedEtag,
      start: action.desired.start,
      end: action.desired.end,
      sendUpdates: "none",
    });
    expect(observations.before).toMatchObject({
      status: "in_progress",
      beforeState: {
        approvedPlanVersion: plan.version,
        approvedPlanDigest: plan.digest,
        snapshot: {
          etag: action.preconditions.expectedEtag,
          start: action.preconditions.expectedStart,
          end: action.preconditions.expectedEnd,
          attendeeSetDigest: action.preconditions.attendeeSetDigest,
        },
      },
    });
    if (!observations.before) throw new Error("Expected the Calendar action row before the provider update.");
    expect(result.record.beforeState).toEqual(observations.before.beforeState);
    expect(result.record.afterState).toMatchObject({ snapshot: { start: action.desired.start, end: action.desired.end } });
    expect(result.receipt).toMatchObject({ provider: "google_calendar", operation: "move", providerEventId: action.target.providerEventId, verified: true });
    expect(result.receipt?.resultingEtag).not.toBe(action.preconditions.expectedEtag);
  });

  it("skips a succeeded Calendar action on replay without a second provider update", async () => {
    const { store, calendar, plan, configuration } = await createApproved();
    let updateCalls = 0;
    const port = instrumentCalendar(calendar, { onUpdate: () => { updateCalls += 1; } });
    const first = await executeApprovedInitialCalendar(executionInput(plan), { executionStore: store, calendar: port, configuration });
    const replay = await executeApprovedInitialCalendar(executionInput(plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: store, calendar: port, configuration });
    expect(first.decision).toBe("succeeded");
    expect(replay.decision).toBe("skipped");
    expect(replay.record.actionExecutionId).toBe(first.record.actionExecutionId);
    expect(replay.receipt).toEqual(first.receipt);
    expect(updateCalls).toBe(1);
  });

  it("stops on a changed approved ETag before any approved write", async () => {
    const { store, calendar, plan, configuration } = await createApproved();
    const action = calendarAction(plan);
    await calendar.updateStartEnd({
      calendarId: action.target.calendarId,
      providerEventId: action.target.providerEventId,
      expectedEtag: action.preconditions.expectedEtag,
      start: action.preconditions.expectedStart,
      end: action.preconditions.expectedEnd,
      sendUpdates: "none",
    });
    let updateCalls = 0;
    const result = await executeApprovedInitialCalendar(executionInput(plan), {
      executionStore: store,
      calendar: instrumentCalendar(calendar, { onUpdate: () => { updateCalls += 1; } }),
      configuration,
    });
    expect(result).toMatchObject({ decision: "conflict", reason: "precondition_changed", record: { status: "conflict" } });
    expect(result.record.beforeState).toMatchObject({ snapshot: { etag: expect.not.stringMatching(action.preconditions.expectedEtag) } });
    expect(updateCalls).toBe(0);
  });

  it("stops on allowlist drift before the Calendar write", async () => {
    const { store, calendar, plan, configuration } = await createApproved();
    let updateCalls = 0;
    const driftedConfiguration: CalendarDemoConfiguration = {
      ...configuration,
      recipients: { UK: ["different-team@example.com"], US: [...configuration.recipients.US] },
    };
    const result = await executeApprovedInitialCalendar(executionInput(plan), {
      executionStore: store,
      calendar: instrumentCalendar(calendar, { onUpdate: () => { updateCalls += 1; } }),
      configuration: driftedConfiguration,
    });
    expect(result).toMatchObject({ decision: "conflict", reason: "precondition_changed", record: { status: "conflict" } });
    expect(updateCalls).toBe(0);
  });

  it("records known pre-write unavailability as retryable and succeeds only on an explicit retry", async () => {
    const { store, calendar, plan, configuration } = await createApproved();
    let readCalls = 0;
    const port = instrumentCalendar(calendar, {
      get: async (input) => {
        readCalls += 1;
        if (readCalls === 1) throw new CalendarProviderError("unavailable");
        return calendar.getControlledEvent(input);
      },
    });
    const first = await executeApprovedInitialCalendar(executionInput(plan), { executionStore: store, calendar: port, configuration });
    expect(first).toMatchObject({ decision: "retryable_failed", reason: "provider_unavailable", record: { status: "retryable_failed" } });
    const second = await executeApprovedInitialCalendar(executionInput(plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: store, calendar: port, configuration });
    expect(second.decision).toBe("succeeded");
    expect(second.record.attempts).toBe(2);
  });

  it("treats an ambiguous update outcome as a durable conflict", async () => {
    const { store, calendar, plan, configuration } = await createApproved();
    const result = await executeApprovedInitialCalendar(executionInput(plan), {
      executionStore: store,
      calendar: instrumentCalendar(calendar, { update: async () => { throw new CalendarProviderError("unavailable"); } }),
      configuration,
    });
    expect(result).toMatchObject({ decision: "conflict", reason: "calendar_uncertain", record: { status: "conflict", error: { code: "calendar_uncertain", retryable: false } } });
    expect(result.record.beforeState).toBeDefined();
    expect(result.record.afterState).toBeUndefined();
  });

  it("does not call Calendar when the durable before-state cannot be recorded", async () => {
    const { plan, calendar, configuration } = await createApproved();
    class FailingBeforeStateStore extends MemoryExecutionPersistenceStore {
      failCalendarBefore = true;

      override async recordActionState(input: Parameters<MemoryExecutionPersistenceStore["recordActionState"]>[0]) {
        const beforeState = input.beforeState as Record<string, unknown> | undefined;
        if (this.failCalendarBefore && input.status === "in_progress" && beforeState && "snapshot" in beforeState) {
          this.failCalendarBefore = false;
          throw new ExecutionPersistenceError("persistence_failure", "Calendar before-state write failed");
        }
        return super.recordActionState(input);
      }
    }
    const store = new FailingBeforeStateStore();
    await store.createPlan(plan);
    await store.createApproval({ approvalId: "appr_s054_calendar_test_02", planId: plan.planId, planVersion: plan.version, planDigest: plan.digest, actorId: "test:operator", approvedAt: now });
    await prepareInitialActionRows(plan, store);
    await executeApprovedInitialArtifact(executionInput(plan), { executionStore: store, artifactPort: new FakeArtifactPort({ storedAt: "2026-07-16T12:00:01.000Z" }) });
    let updateCalls = 0;
    await expect(executeApprovedInitialCalendar(executionInput(plan), {
      executionStore: store,
      calendar: instrumentCalendar(calendar, { onUpdate: () => { updateCalls += 1; } }),
      configuration,
    })).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(updateCalls).toBe(0);
  });

  it("fails verification when the provider does not return a new ETag", async () => {
    const { store, calendar, plan, configuration } = await createApproved();
    const action = calendarAction(plan);
    const result = await executeApprovedInitialCalendar(executionInput(plan), {
      executionStore: store,
      calendar: instrumentCalendar(calendar, {
        update: async (input) => ({ ...(await calendar.updateStartEnd(input)), etag: action.preconditions.expectedEtag }),
      }),
      configuration,
    });
    expect(result).toMatchObject({ decision: "conflict", reason: "verification_failed", record: { status: "conflict" } });
    expect(result.record.beforeState).toBeDefined();
    expect(result.record.afterState).toMatchObject({ snapshot: { etag: action.preconditions.expectedEtag } });
  });

  it("requires the artifact action to succeed before Calendar can be claimed", async () => {
    const { store, calendar, plan, configuration } = await createApproved({ completeArtifact: false });
    let readCalls = 0;
    const resultPromise = executeApprovedInitialCalendar(executionInput(plan), {
      executionStore: store,
      calendar: instrumentCalendar(calendar, { get: async () => { readCalls += 1; throw new Error("must not read"); } }),
      configuration,
    });
    await expect(resultPromise).rejects.toMatchObject({ code: "invalid_task_state" });
    expect(readCalls).toBe(0);
  });
});
