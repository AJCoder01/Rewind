import { describe, expect, it } from "vitest";
import { FakeArtifactPort } from "@/lib/adapters/artifact";
import { FakeCalendarPort, type CalendarPort } from "@/lib/adapters/calendar";
import type { CalendarConditionalTimeUpdate, GmailApprovedMessage, GmailSendReceipt } from "@/lib/contracts/provider-ports";
import { GmailApprovedMessageSchema } from "@/lib/contracts/provider-ports";
import type { ExecutionPlan } from "@/lib/contracts/execution-persistence";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { MemoryExecutionPersistenceStore } from "@/lib/db/execution-store";
import type { CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";
import { buildControlledCalendarSeeds } from "@/lib/domain/calendar-demo";
import { assertAccountBriefIndependent } from "@/lib/domain/account-brief";
import { sha256Text } from "@/lib/domain/digest";
import { FakeModelPort } from "@/lib/ai/model";
import { ACCOUNT_BRIEF_TITLE } from "@/lib/domain/account-brief";
import { resolveControlledCandidates } from "@/lib/services/candidate-resolution";
import { reasonInitialRequest } from "@/lib/services/initial-reasoning";
import { expandInitialPlan } from "@/lib/services/initial-plan-expansion";
import { executeApprovedInitialArtifact } from "@/lib/services/initial-artifact-execution";
import { executeApprovedInitialCalendar } from "@/lib/services/initial-calendar-execution";
import { executeApprovedInitialGmail } from "@/lib/services/initial-gmail-execution";
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

const allowlist = { UK: ["uk-team@example.com"], US: ["us-team@example.com"] };
const now = "2026-07-16T12:00:00.000Z";
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

type WorkflowSetup = Readonly<{
  store: MemoryExecutionPersistenceStore;
  calendar: FakeCalendarPort;
  plan: ExecutionPlan;
  approval: {
    approvalId: string;
    planId: string;
    planVersion: number;
    planDigest: string;
    actorId: string;
    approvedAt: string;
  };
}>;

async function createApproved(): Promise<WorkflowSetup> {
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
    taskId: "wpr_s057_workflow_test_01",
    planId: "plan_s057_workflow_test_01",
    runId: "run_s057_workflow_test_01",
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
  const approval = {
    approvalId: "appr_s057_workflow_test_01",
    planId: plan.planId,
    planVersion: plan.version,
    planDigest: plan.digest,
    actorId: "test:operator",
    approvedAt: now,
  };
  await store.createPlan(plan);
  await store.createApproval(approval);
  await prepareInitialActionRows(plan, store);
  return { store, calendar, plan, approval };
}

function executionInput(plan: ExecutionPlan, overrides: Record<string, string> = {}) {
  return {
    actorId: "test:operator",
    source: "dashboard" as const,
    planId: plan.planId,
    planDigest: plan.digest,
    now: overrides.now ?? now,
    leaseUntil: overrides.leaseUntil ?? "2026-07-16T12:01:00.000Z",
  };
}

function planPayload(plan: ExecutionPlan) {
  return VerifiedInitialPlanPayloadSchema.parse(plan.payload);
}

function instrumentCalendar(base: FakeCalendarPort, onUpdate: (input: CalendarConditionalTimeUpdate) => void): CalendarPort {
  return {
    listControlledEvents: (input) => base.listControlledEvents(input),
    getControlledEvent: (input) => base.getControlledEvent(input),
    createControlledEvent: (input) => base.createControlledEvent(input),
    updateStartEnd: async (input) => {
      onUpdate(input);
      return base.updateStartEnd(input);
    },
  };
}

class RecordingGmailPort {
  preparations: GmailApprovedMessage[] = [];
  sent: GmailApprovedMessage[] = [];
  attempts = 0;
  outcome: GmailSendReceipt = { status: "sent", messageId: "gmail-message-s057", threadId: "gmail-thread-s057" };
  onSend?: (input: GmailApprovedMessage) => Promise<void> | void;
  waitForRelease?: Promise<void>;

  prepareApprovedMessage(input: GmailApprovedMessage): void {
    this.preparations.push(GmailApprovedMessageSchema.parse(input));
  }

  async sendApprovedMessage(input: GmailApprovedMessage): Promise<GmailSendReceipt> {
    const parsed = GmailApprovedMessageSchema.parse(input);
    this.attempts += 1;
    this.sent.push(parsed);
    await this.onSend?.(parsed);
    if (this.waitForRelease) await this.waitForRelease;
    return this.outcome;
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
}

async function completeArtifactAndCalendar(setup: WorkflowSetup, artifactPort = new FakeArtifactPort({ storedAt: "2026-07-16T12:00:01.000Z" })) {
  const artifact = await executeApprovedInitialArtifact(executionInput(setup.plan), { executionStore: setup.store, artifactPort });
  const calendar = await executeApprovedInitialCalendar(executionInput(setup.plan), {
    executionStore: setup.store,
    calendar: setup.calendar,
    configuration: calendarConfiguration,
  });
  return { artifact, calendar, artifactPort };
}

describe("S057 deterministic initial workflow verification", () => {
  it("completes the exact approved workflow once and replays without duplicate effects", async () => {
    const setup = await createApproved();
    const artifactPort = new FakeArtifactPort({ storedAt: "2026-07-16T12:00:01.000Z" });
    const updates: CalendarConditionalTimeUpdate[] = [];
    const calendar = instrumentCalendar(setup.calendar, (input) => updates.push(input));
    const gmail = new RecordingGmailPort();

    const artifact = await executeApprovedInitialArtifact(executionInput(setup.plan), { executionStore: setup.store, artifactPort });
    const moved = await executeApprovedInitialCalendar(executionInput(setup.plan), {
      executionStore: setup.store,
      calendar,
      configuration: calendarConfiguration,
    });
    const notified = await executeApprovedInitialGmail(executionInput(setup.plan), {
      executionStore: setup.store,
      gmail,
      expectedSenderGoogleSub: planConfiguration.senderGoogleSub,
      allowlist,
    });
    const payload = planPayload(setup.plan);
    const savedArtifact = artifactPort.getSavedForTest();

    expect(artifact.decision).toBe("succeeded");
    expect(moved.decision).toBe("succeeded");
    expect(notified.decision).toBe("succeeded");
    expect(savedArtifact).toEqual(payload.actions[0].desired);
    expect(savedArtifact).not.toBeNull();
    assertAccountBriefIndependent(savedArtifact!.content);
    expect(savedArtifact!.provenance.excludedDimensions).toEqual(["calendar_event", "region", "attendees", "meeting_time"]);
    expect(updates).toEqual([{
      calendarId: payload.actions[1].target.calendarId,
      providerEventId: payload.actions[1].target.providerEventId,
      expectedEtag: payload.actions[1].preconditions.expectedEtag,
      start: payload.actions[1].desired.start,
      end: payload.actions[1].desired.end,
      sendUpdates: "none",
    }]);
    expect(gmail.sent).toEqual([payload.actions[2].desired]);
    expect((await setup.store.listActions(setup.plan.planId)).map((action) => action.actionKey)).toEqual(payload.executionOrder);
    expect((await setup.store.listActions(setup.plan.planId)).every((action) => action.status === "succeeded")).toBe(true);

    const approvalReplay = await setup.store.createApproval(setup.approval);
    const artifactReplay = await executeApprovedInitialArtifact(executionInput(setup.plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: setup.store, artifactPort });
    const calendarReplay = await executeApprovedInitialCalendar(executionInput(setup.plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: setup.store, calendar, configuration: calendarConfiguration });
    const gmailReplay = await executeApprovedInitialGmail(executionInput(setup.plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: setup.store, gmail, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist });

    expect(approvalReplay.replay).toBe(true);
    expect(artifactReplay.decision).toBe("skipped");
    expect(calendarReplay.decision).toBe("skipped");
    expect(gmailReplay.decision).toBe("skipped");
    expect(updates).toHaveLength(1);
    expect(gmail.attempts).toBe(1);
  });

  it("rejects out-of-order, stale-digest, MCP, and unapproved execution before provider calls", async () => {
    const setup = await createApproved();
    let calendarGets = 0;
    const calendar = instrumentCalendar(setup.calendar, () => { calendarGets += 1; });
    const artifactPort = new FakeArtifactPort();
    const gmail = new RecordingGmailPort();

    await expect(executeApprovedInitialCalendar(executionInput(setup.plan), { executionStore: setup.store, calendar, configuration: calendarConfiguration })).rejects.toMatchObject({ code: "invalid_task_state" });
    await expect(executeApprovedInitialGmail(executionInput(setup.plan), { executionStore: setup.store, gmail, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist })).rejects.toMatchObject({ code: "invalid_task_state" });
    await expect(executeApprovedInitialArtifact({ ...executionInput(setup.plan), planDigest: `sha256:${"f".repeat(64)}` }, { executionStore: setup.store, artifactPort })).rejects.toMatchObject({ code: "plan_digest_mismatch" });
    await expect(executeApprovedInitialArtifact({ ...executionInput(setup.plan), source: "mcp" }, { executionStore: setup.store, artifactPort })).rejects.toMatchObject({ code: "forbidden" });

    const rows = await setup.store.listActions(setup.plan.planId);
    expect(rows.every((action) => action.status === "planned")).toBe(true);
    expect(calendarGets).toBe(0);
    expect(gmail.attempts).toBe(0);
  });

  it("resumes a known-safe artifact failure and preserves the fixed dependency order", async () => {
    const setup = await createApproved();
    const failed = await executeApprovedInitialArtifact(executionInput(setup.plan), {
      executionStore: setup.store,
      artifactPort: new FakeArtifactPort({ failure: "unavailable" }),
    });
    expect(failed).toMatchObject({ decision: "retryable_failed", record: { status: "retryable_failed", attempts: 1 } });
    await expect(executeApprovedInitialCalendar(executionInput(setup.plan), { executionStore: setup.store, calendar: setup.calendar, configuration: calendarConfiguration })).rejects.toMatchObject({ code: "invalid_task_state" });

    const resumedArtifact = await completeArtifactAndCalendar(setup, new FakeArtifactPort({ storedAt: "2026-07-16T12:02:01.000Z" }));
    const gmail = new RecordingGmailPort();
    const resumedMail = await executeApprovedInitialGmail(executionInput(setup.plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), {
      executionStore: setup.store,
      gmail,
      expectedSenderGoogleSub: planConfiguration.senderGoogleSub,
      allowlist,
    });

    expect(resumedArtifact.artifact.decision).toBe("succeeded");
    expect(resumedArtifact.artifact.record.attempts).toBe(2);
    expect(resumedArtifact.calendar.decision).toBe("succeeded");
    expect(resumedMail.decision).toBe("succeeded");
    expect(gmail.attempts).toBe(1);
  });

  it("turns process death into delivery uncertainty or Calendar reconciliation without retrying", async () => {
    const mailSetup = await createApproved();
    await completeArtifactAndCalendar(mailSetup);
    const mailAction = (await mailSetup.store.listActions(mailSetup.plan.planId)).find((action) => action.actionKey === "initial.mail.notify");
    if (!mailAction) throw new Error("Expected the Gmail action row.");
    await mailSetup.store.claimAction({ actionExecutionId: mailAction.actionExecutionId, now, leaseUntil: "2026-07-16T12:00:30.000Z", dispatchStartedAt: now });
    const gmail = new RecordingGmailPort();
    const uncertain = await executeApprovedInitialGmail(executionInput(mailSetup.plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), {
      executionStore: mailSetup.store,
      gmail,
      expectedSenderGoogleSub: planConfiguration.senderGoogleSub,
      allowlist,
    });

    const calendarSetup = await createApproved();
    await executeApprovedInitialArtifact(executionInput(calendarSetup.plan), { executionStore: calendarSetup.store, artifactPort: new FakeArtifactPort() });
    const calendarAction = (await calendarSetup.store.listActions(calendarSetup.plan.planId)).find((action) => action.actionKey === "initial.calendar.move");
    if (!calendarAction) throw new Error("Expected the Calendar action row.");
    await calendarSetup.store.claimAction({ actionExecutionId: calendarAction.actionExecutionId, now, leaseUntil: "2026-07-16T12:00:30.000Z" });
    let updateCalls = 0;
    const reconciled = await executeApprovedInitialCalendar(executionInput(calendarSetup.plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), {
      executionStore: calendarSetup.store,
      calendar: instrumentCalendar(calendarSetup.calendar, () => { updateCalls += 1; }),
      configuration: calendarConfiguration,
    });

    expect(uncertain).toMatchObject({ decision: "blocked", reason: "delivery_uncertain", record: { status: "delivery_uncertain", dispatchStartedAt: now } });
    expect(gmail.attempts).toBe(0);
    expect(reconciled).toMatchObject({ decision: "blocked", reason: "reconciliation_required", record: { status: "conflict", error: { code: "reconciliation_required" } } });
    expect(updateCalls).toBe(0);
  });

  it("fails closed on stale Calendar state and allowlist drift", async () => {
    const calendarSetup = await createApproved();
    await executeApprovedInitialArtifact(executionInput(calendarSetup.plan), { executionStore: calendarSetup.store, artifactPort: new FakeArtifactPort() });
    const calendarAction = planPayload(calendarSetup.plan).actions[1];
    await calendarSetup.calendar.updateStartEnd({
      calendarId: calendarAction.target.calendarId,
      providerEventId: calendarAction.target.providerEventId,
      expectedEtag: calendarAction.preconditions.expectedEtag,
      start: calendarAction.preconditions.expectedStart,
      end: calendarAction.preconditions.expectedEnd,
      sendUpdates: "none",
    });
    let updateCalls = 0;
    const stale = await executeApprovedInitialCalendar(executionInput(calendarSetup.plan), {
      executionStore: calendarSetup.store,
      calendar: instrumentCalendar(calendarSetup.calendar, () => { updateCalls += 1; }),
      configuration: calendarConfiguration,
    });

    const mailSetup = await createApproved();
    await completeArtifactAndCalendar(mailSetup);
    const gmail = new RecordingGmailPort();
    const drifted = await executeApprovedInitialGmail(executionInput(mailSetup.plan), {
      executionStore: mailSetup.store,
      gmail,
      expectedSenderGoogleSub: planConfiguration.senderGoogleSub,
      allowlist: { UK: ["other-team@example.com"], US: [...allowlist.US] },
    });

    expect(stale).toMatchObject({ decision: "conflict", reason: "precondition_changed", record: { status: "conflict" } });
    expect(updateCalls).toBe(0);
    expect(drifted).toMatchObject({ decision: "blocked", reason: "recipient_not_allowed", record: { status: "conflict" } });
    expect(gmail.preparations).toHaveLength(0);
    expect(gmail.attempts).toBe(0);
  });

  it("returns a busy decision for a duplicate click while the first Gmail handoff is still leased", async () => {
    const setup = await createApproved();
    await completeArtifactAndCalendar(setup);
    const gmail = new RecordingGmailPort();
    const started = deferred();
    const release = deferred();
    gmail.onSend = () => { started.resolve(); };
    gmail.waitForRelease = release.promise;

    const firstPromise = executeApprovedInitialGmail(executionInput(setup.plan), {
      executionStore: setup.store,
      gmail,
      expectedSenderGoogleSub: planConfiguration.senderGoogleSub,
      allowlist,
    });
    await started.promise;
    const duplicate = await executeApprovedInitialGmail(executionInput(setup.plan), {
      executionStore: setup.store,
      gmail,
      expectedSenderGoogleSub: planConfiguration.senderGoogleSub,
      allowlist,
    });
    release.resolve();
    const first = await firstPromise;

    expect(duplicate).toMatchObject({ decision: "busy", reason: "active_lease", record: { status: "in_progress" } });
    expect(first.decision).toBe("succeeded");
    expect(gmail.attempts).toBe(1);
  });
});
