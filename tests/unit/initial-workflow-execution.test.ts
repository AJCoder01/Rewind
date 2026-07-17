import { beforeEach, describe, expect, it } from "vitest";
import { FakeArtifactPort } from "@/lib/adapters/artifact";
import { FakeCalendarPort, type CalendarPort } from "@/lib/adapters/calendar";
import type { GmailPort } from "@/lib/adapters/gmail";
import { FakeModelPort } from "@/lib/ai/model";
import type { GmailSendReceipt } from "@/lib/contracts/provider-ports";
import type { ExecutionPlan } from "@/lib/contracts/execution-persistence";
import type { InitialPlanPayload, TaskMutationResponse, WorldPrView } from "@/lib/contracts/v1";
import { MemoryExecutionPersistenceStore } from "@/lib/db/execution-store";
import type {
  CancelWorldPrStoreResult,
  CreateWorldPrStoreResult,
  MutationIdempotencyClaim,
  MutationIdempotencyFailure,
  MutationIdempotencyInput,
  MutationIdempotencyLease,
  WorldPrStore,
} from "@/lib/db/store";
import { ACCOUNT_BRIEF_CONTENT_FIXTURE, ACCOUNT_BRIEF_TITLE } from "@/lib/domain/account-brief";
import { buildControlledCalendarSeeds, type CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";
import { sha256Text } from "@/lib/domain/digest";
import { resolveControlledCandidates } from "@/lib/services/candidate-resolution";
import { expandInitialPlan } from "@/lib/services/initial-plan-expansion";
import { reasonInitialRequest } from "@/lib/services/initial-reasoning";
import { executeApprovedInitialWorkflow, type InitialWorkflowRuntime } from "@/lib/services/initial-workflow-execution";
import { prepareInitialActionRows } from "@/lib/services/initial-execution";

const now = "2026-07-17T06:30:00.000Z";
const configuration: CalendarDemoConfiguration = {
  calendarId: "demo-calendar-2026",
  demoDate: "2026-08-20",
  expectedEmail: "owner@example.com",
  recipients: { UK: ["uk-team@example.com"], US: ["us-team@example.com"] },
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
  accountBrief: {
    title: ACCOUNT_BRIEF_TITLE,
    content: ACCOUNT_BRIEF_CONTENT_FIXTURE,
    sourceId: "acme_parent_account_notes" as const,
  },
};

class TestWorldStore implements WorldPrStore {
  private mutation: { input: MutationIdempotencyInput; status: "in_progress" | "completed" | "failed"; response?: TaskMutationResponse; failure?: MutationIdempotencyFailure } | undefined;
  constructor(public view: WorldPrView) {}

  async get(): Promise<WorldPrView> { return structuredClone(this.view); }
  async updateView(_worldPrId: string, view: WorldPrView): Promise<void> { this.view = structuredClone(view); }
  async claimMutation(input: MutationIdempotencyInput): Promise<MutationIdempotencyClaim> {
    if (!this.mutation || this.mutation.input.idempotencyKey !== input.idempotencyKey) {
      this.mutation = { input, status: "in_progress" };
      return { kind: "claimed", claimToken: `claim_${input.idempotencyKey}` };
    }
    if (this.mutation.input.bodyHash !== input.bodyHash) throw new Error("idempotency conflict");
    if (this.mutation.status === "completed") return { kind: "replay_completed", response: this.mutation.response! };
    if (this.mutation.status === "failed") return { kind: "replay_failed", failure: this.mutation.failure! };
    return { kind: "replay_pending", claimToken: `claim_${input.idempotencyKey}` };
  }
  async completeMutation(_input: MutationIdempotencyLease, response: TaskMutationResponse): Promise<void> {
    if (!this.mutation) throw new Error("missing mutation");
    this.mutation = { ...this.mutation, status: "completed", response };
  }
  async recoverMutation(input: MutationIdempotencyLease, response: TaskMutationResponse): Promise<void> { return this.completeMutation(input, response); }
  async failMutation(_input: MutationIdempotencyLease, failure: MutationIdempotencyFailure): Promise<void> {
    if (!this.mutation) throw new Error("missing mutation");
    this.mutation = { ...this.mutation, status: "failed", failure };
  }
  async createInitial(): Promise<CreateWorldPrStoreResult> { throw new Error("not used"); }
  async getInitialPlanPayload(): Promise<null> { return null; }
  async persistInitialPlanVersion(_worldPrId: string, _payload: InitialPlanPayload, view: WorldPrView): Promise<void> { this.view = structuredClone(view); }
  async cancel(): Promise<CancelWorldPrStoreResult> { throw new Error("not used"); }
}

class RecordingGmail implements GmailPort {
  prepared = 0;
  sent = 0;
  prepareApprovedMessage(): void { this.prepared += 1; }
  async sendApprovedMessage(): Promise<GmailSendReceipt> {
    this.sent += 1;
    return { status: "sent", messageId: "gmail-message-integration" };
  }
}

async function setup() {
  const calendar = new FakeCalendarPort({ events: [], organizerDigest: sha256Text(configuration.expectedEmail) });
  for (const seed of buildControlledCalendarSeeds(configuration)) await calendar.createControlledEvent(seed);
  const resolution = await resolveControlledCandidates({ calendar, configuration, now: new Date(now) });
  const reasoning = await reasonInitialRequest({
    request: "controlled request",
    resolution,
    model: new FakeModelPort({ outputs: { initial: proposal } }),
    now: new Date(now),
  });
  const expanded = expandInitialPlan({
    request: "controlled request",
    taskId: "wpr_execution_integration_01",
    planId: "plan_execution_integration_01",
    runId: "run_execution_integration_01",
    resolution,
    reasoning,
    configuration: {
      calendarId: configuration.calendarId,
      expectedEmail: configuration.expectedEmail,
      senderGoogleSub: "google-subject-001",
      recipients: { UK: [...configuration.recipients.UK], US: [...configuration.recipients.US] },
    },
    now: new Date(now),
  });
  const plan: ExecutionPlan = {
    planId: expanded.planPayload.planId,
    taskId: expanded.planPayload.taskId,
    kind: "initial",
    version: expanded.planPayload.version,
    schemaVersion: expanded.planPayload.schemaVersion,
    promptVersion: expanded.planPayload.modelMetadata.promptVersion,
    model: expanded.planPayload.modelMetadata.model,
    payload: expanded.planPayload,
    digest: expanded.planPayload.digest,
    createdAt: expanded.createdAt,
  };
  const executionStore = new MemoryExecutionPersistenceStore();
  await executionStore.createPlan(plan);
  await executionStore.createApproval({
    approvalId: "approval_execution_integration_01",
    planId: plan.planId,
    planVersion: plan.version,
    planDigest: plan.digest,
    actorId: "test:operator",
    approvedAt: now,
  });
  await prepareInitialActionRows(plan, executionStore, { now: () => new Date(now) });
  const view: WorldPrView = {
    worldPrId: plan.taskId,
    runId: expanded.planPayload.actions[2].desired.runId,
    request: expanded.planPayload.request,
    status: "executing",
    activePlan: expanded.planView,
    timeline: [{ eventId: "event_execution_ready_01", type: "approval.recorded", occurredAt: now, label: "Approved", status: "executing" }],
    createdAt: now,
    updatedAt: now,
  };
  const worldStore = new TestWorldStore(view);
  const artifactPort = new FakeArtifactPort({ storedAt: "2026-07-17T06:30:01.000Z" });
  const gmail = new RecordingGmail();
  const runtime: InitialWorkflowRuntime = {
    artifactPort,
    calendar,
    gmail,
    calendarConfiguration: configuration,
    expectedSenderGoogleSub: "google-subject-001",
    allowlist: { UK: ["uk-team@example.com"], US: ["us-team@example.com"] },
  };
  return { plan, worldStore, executionStore, calendar, artifactPort, gmail, runtime };
}

function executeInput(plan: ExecutionPlan, key: string) {
  return {
    actorId: "test:operator",
    source: "dashboard" as const,
    idempotencyKey: key,
    requestId: `req_${key}`,
    worldPrId: plan.taskId,
    request: { planId: plan.planId, planVersion: plan.version, planDigest: plan.digest },
  };
}

describe("pre-S058 product initial workflow execution", () => {
  beforeEach(() => {
    // The deterministic clock advances per action so every claim has a fresh fence.
  });

  it("preflights, executes artifact → Calendar → Gmail, completes the task, and replays without providers", async () => {
    const setupValue = await setup();
    let tick = 0;
    const result = await executeApprovedInitialWorkflow(executeInput(setupValue.plan, "execute-integration-0001"), {
      worldStore: setupValue.worldStore,
      executionStore: setupValue.executionStore,
      loadRuntime: async () => setupValue.runtime,
      now: () => new Date(Date.parse(now) + tick++ * 1000),
    });
    expect(result.response.status).toBe("completed");
    expect((await setupValue.executionStore.listActions(setupValue.plan.planId)).map((action) => action.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(setupValue.artifactPort.getSavedForTest()).not.toBeNull();
    expect(setupValue.gmail.sent).toBe(1);

    const replay = await executeApprovedInitialWorkflow(executeInput(setupValue.plan, "execute-integration-0002"), {
      worldStore: setupValue.worldStore,
      executionStore: setupValue.executionStore,
      loadRuntime: async () => { throw new Error("provider runtime must not load on completed replay"); },
      now: () => new Date("2026-07-17T07:00:00.000Z"),
    });
    expect(replay).toMatchObject({ replay: true, response: { status: "completed" } });
    expect(setupValue.gmail.sent).toBe(1);
  });

  it("serializes concurrent execution requests with different idempotency keys", async () => {
    const setupValue = await setup();
    let tick = 0;
    let runtimeLoads = 0;
    const dependencies = {
      worldStore: setupValue.worldStore,
      executionStore: setupValue.executionStore,
      loadRuntime: async () => {
        runtimeLoads += 1;
        return setupValue.runtime;
      },
      now: () => new Date(Date.parse(now) + tick++ * 1000),
    };

    const [first, second] = await Promise.all([
      executeApprovedInitialWorkflow(executeInput(setupValue.plan, "execute-concurrent-0001"), dependencies),
      executeApprovedInitialWorkflow(executeInput(setupValue.plan, "execute-concurrent-0002"), dependencies),
    ]);

    expect(first.response.status).toBe("completed");
    expect(second).toMatchObject({ replay: true, response: { status: "completed" } });
    expect(runtimeLoads).toBe(1);
    expect(setupValue.gmail.sent).toBe(1);
    expect((await setupValue.executionStore.listActions(setupValue.plan.planId)).map((action) => action.attempts)).toEqual([1, 1, 1]);
  });

  it("detects Calendar drift during whole-plan preflight before artifact or mail", async () => {
    const setupValue = await setup();
    const calendarAction = (setupValue.plan.payload as InitialPlanPayload).actions[1];
    await setupValue.calendar.updateStartEnd({
      ...calendarAction.target,
      expectedEtag: calendarAction.preconditions.expectedEtag,
      start: calendarAction.preconditions.expectedStart,
      end: calendarAction.preconditions.expectedEnd,
      sendUpdates: "none",
    });
    await expect(executeApprovedInitialWorkflow(executeInput(setupValue.plan, "execute-stale-plan-0001"), {
      worldStore: setupValue.worldStore,
      executionStore: setupValue.executionStore,
      loadRuntime: async () => setupValue.runtime,
      now: () => new Date(now),
    })).rejects.toMatchObject({ code: "plan_stale" });
    expect(setupValue.artifactPort.getSavedForTest()).toBeNull();
    expect(setupValue.gmail.sent).toBe(0);
    expect((await setupValue.executionStore.listActions(setupValue.plan.planId)).every((action) => action.status === "planned")).toBe(true);
  });

  it("invalidates stale approval and persists a fresh unapproved version before any effect", async () => {
    const setupValue = await setup();
    const payload = setupValue.plan.payload as InitialPlanPayload;
    const calendarAction = payload.actions[1];
    await setupValue.calendar.updateStartEnd({
      ...calendarAction.target,
      expectedEtag: calendarAction.preconditions.expectedEtag,
      start: calendarAction.preconditions.expectedStart,
      end: calendarAction.preconditions.expectedEnd,
      sendUpdates: "none",
    });
    const runtime: InitialWorkflowRuntime = {
      ...setupValue.runtime,
      buildReplacement: async () => {
        const resolution = await resolveControlledCandidates({ calendar: setupValue.calendar, configuration, now: new Date(now) });
        const reasoning = await reasonInitialRequest({
          request: payload.request,
          resolution,
          model: new FakeModelPort({ outputs: { initial: proposal } }),
          now: new Date(now),
        });
        return expandInitialPlan({
          request: payload.request,
          taskId: payload.taskId,
          planId: "plan_execution_integration_02",
          runId: payload.actions[2].desired.runId,
          version: payload.version + 1,
          resolution,
          reasoning,
          configuration: {
            calendarId: configuration.calendarId,
            expectedEmail: configuration.expectedEmail,
            senderGoogleSub: "google-subject-001",
            recipients: { UK: [...configuration.recipients.UK], US: [...configuration.recipients.US] },
          },
          now: new Date(now),
        }).planPayload;
      },
    };
    const result = await executeApprovedInitialWorkflow(executeInput(setupValue.plan, "execute-auto-refresh-0001"), {
      worldStore: setupValue.worldStore,
      executionStore: setupValue.executionStore,
      loadRuntime: async () => runtime,
      now: () => new Date(now),
    });
    expect(result.response).toMatchObject({ status: "preview_ready", activePlan: { version: 2 } });
    expect((await setupValue.executionStore.listActions(setupValue.plan.planId)).map((action) => action.error?.code)).toEqual(["plan_stale", "plan_stale", "plan_stale"]);
    expect(setupValue.artifactPort.getSavedForTest()).toBeNull();
    expect(setupValue.gmail.sent).toBe(0);
  });

  it("detects regional allowlist drift before artifact or Calendar write", async () => {
    const setupValue = await setup();
    let updates = 0;
    const base = setupValue.runtime.calendar;
    const calendar: CalendarPort = {
      listControlledEvents: (input) => base.listControlledEvents(input),
      getControlledEvent: (input) => base.getControlledEvent(input),
      createControlledEvent: (input) => base.createControlledEvent(input),
      updateStartEnd: async (input) => { updates += 1; return base.updateStartEnd(input); },
    };
    await expect(executeApprovedInitialWorkflow(executeInput(setupValue.plan, "execute-allowlist-drift-0001"), {
      worldStore: setupValue.worldStore,
      executionStore: setupValue.executionStore,
      loadRuntime: async () => ({
        ...setupValue.runtime,
        calendar,
        allowlist: { UK: ["different-uk@example.com"], US: ["us-team@example.com"] },
      }),
      now: () => new Date(now),
    })).rejects.toMatchObject({ code: "plan_stale" });
    expect(setupValue.artifactPort.getSavedForTest()).toBeNull();
    expect(updates).toBe(0);
    expect(setupValue.gmail.sent).toBe(0);
  });
});
