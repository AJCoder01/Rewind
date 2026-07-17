import { describe, expect, it } from "vitest";
import {
  GmailProviderError,
  type GmailPort,
} from "@/lib/adapters/gmail";
import { FakeArtifactPort } from "@/lib/adapters/artifact";
import { type ActionExecutionRecord, type ExecutionPlan } from "@/lib/contracts/execution-persistence";
import { GmailApprovedMessageSchema, type GmailApprovedMessage, type GmailSendReceipt } from "@/lib/contracts/provider-ports";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { MemoryExecutionPersistenceStore, ExecutionPersistenceError } from "@/lib/db/execution-store";
import { buildControlledCalendarSeeds, type CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";
import { sha256Text } from "@/lib/domain/digest";
import { ACCOUNT_BRIEF_TITLE } from "@/lib/domain/account-brief";
import { FakeModelPort } from "@/lib/ai/model";
import { FakeCalendarPort } from "@/lib/adapters/calendar";
import { resolveControlledCandidates } from "@/lib/services/candidate-resolution";
import { reasonInitialRequest } from "@/lib/services/initial-reasoning";
import { expandInitialPlan } from "@/lib/services/initial-plan-expansion";
import { executeApprovedInitialArtifact } from "@/lib/services/initial-artifact-execution";
import { executeApprovedInitialCalendar } from "@/lib/services/initial-calendar-execution";
import { executeApprovedInitialGmail, type InitialGmailExecutionInput } from "@/lib/services/initial-gmail-execution";
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
const allowlist = { UK: ["uk-team@example.com"], US: ["us-team@example.com"] };
const driftCases: readonly [string, { UK: string[]; US: string[] }, string][] = [
  ["recipient_not_allowed", { UK: ["other-team@example.com"], US: ["us-team@example.com"] }, planConfiguration.senderGoogleSub],
  ["sender_not_allowed", allowlist, "other-google-sub"],
];

class FailingGmailBeforeStore extends MemoryExecutionPersistenceStore {
  failGmailBefore = false;

  override async recordActionState(input: Parameters<MemoryExecutionPersistenceStore["recordActionState"]>[0]) {
    const beforeState = input.beforeState as Record<string, unknown> | undefined;
    if (this.failGmailBefore && input.status === "in_progress" && beforeState && "messageHash" in beforeState) {
      this.failGmailBefore = false;
      throw new ExecutionPersistenceError("persistence_failure", "Gmail before-state write failed");
    }
    return super.recordActionState(input);
  }
}

class LateTerminalGmailStore extends MemoryExecutionPersistenceStore {
  replaceNextSuccessfulGmailOutcome = false;

  override async recordActionState(input: Parameters<MemoryExecutionPersistenceStore["recordActionState"]>[0]) {
    if (this.replaceNextSuccessfulGmailOutcome && input.status === "succeeded") {
      this.replaceNextSuccessfulGmailOutcome = false;
      await super.recordActionState({
        ...input,
        status: "delivery_uncertain",
        receipt: { status: "delivery_uncertain", reason: "process_interrupted" },
        error: {
          code: "delivery_uncertain",
          retryable: false,
          safeMessage: "A concurrent terminal outcome was already recorded before the Gmail success receipt could be saved.",
        },
      });
    }
    return super.recordActionState(input);
  }
}

type Setup = {
  store: MemoryExecutionPersistenceStore;
  calendar: FakeCalendarPort;
  plan: ExecutionPlan;
};

async function createApproved(options: { store?: MemoryExecutionPersistenceStore; completeCalendar?: boolean } = {}): Promise<Setup> {
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
    taskId: "wpr_s055_gmail_test_01",
    planId: "plan_s055_gmail_test_01",
    runId: "run_s055_gmail_test_01",
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
  const store = options.store ?? new MemoryExecutionPersistenceStore();
  await store.createPlan(plan);
  await store.createApproval({
    approvalId: "appr_s055_gmail_test_01",
    planId: plan.planId,
    planVersion: plan.version,
    planDigest: plan.digest,
    actorId: "test:operator",
    approvedAt: now,
  });
  await prepareInitialActionRows(plan, store);
  const artifact = await executeApprovedInitialArtifact(executionInput(plan), {
    executionStore: store,
    artifactPort: new FakeArtifactPort({ storedAt: "2026-07-16T12:00:01.000Z" }),
  });
  expect(artifact.decision).toBe("succeeded");
  if (options.completeCalendar !== false) {
    const moved = await executeApprovedInitialCalendar(executionInput(plan), { executionStore: store, calendar, configuration: calendarConfiguration });
    expect(moved.decision).toBe("succeeded");
  }
  return { store, calendar, plan };
}

function executionInput(plan: ExecutionPlan, overrides: Partial<InitialGmailExecutionInput> = {}): InitialGmailExecutionInput {
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

function approvedMessage(plan: ExecutionPlan): GmailApprovedMessage {
  return GmailApprovedMessageSchema.parse(VerifiedInitialPlanPayloadSchema.parse(plan.payload).actions[2].desired);
}

class RecordingGmailPort implements GmailPort {
  preparations = 0;
  attempts = 0;
  messages: GmailApprovedMessage[] = [];
  prepareFailure: Error | undefined;
  sendFailure: Error | undefined;
  outcome: GmailSendReceipt = { status: "sent", messageId: "gmail-message-s055", threadId: "gmail-thread-s055" };
  onSend?: (input: GmailApprovedMessage) => Promise<void> | void;
  waitForRelease?: Promise<void>;

  prepareApprovedMessage(input: GmailApprovedMessage): void {
    this.preparations += 1;
    this.messages.push(GmailApprovedMessageSchema.parse(input));
    if (this.prepareFailure) throw this.prepareFailure;
  }

  async sendApprovedMessage(input: GmailApprovedMessage): Promise<GmailSendReceipt> {
    this.attempts += 1;
    const parsed = GmailApprovedMessageSchema.parse(input);
    this.messages.push(parsed);
    await this.onSend?.(parsed);
    if (this.waitForRelease) await this.waitForRelease;
    if (this.sendFailure) throw this.sendFailure;
    return this.outcome;
  }
}

describe("S055 exact approved Gmail execution", () => {
  it("prepares the exact approved message, persists the dispatch marker before send, and skips replay", async () => {
    const { store, plan } = await createApproved();
    const port = new RecordingGmailPort();
    let observedBefore: ActionExecutionRecord | undefined;
    port.onSend = async () => {
      observedBefore = (await store.listActions(plan.planId)).find((action) => action.actionKey === "initial.mail.notify");
    };
    const result = await executeApprovedInitialGmail(executionInput(plan), {
      executionStore: store,
      gmail: port,
      expectedSenderGoogleSub: planConfiguration.senderGoogleSub,
      allowlist,
    });
    const replay = await executeApprovedInitialGmail(executionInput(plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), {
      executionStore: store,
      gmail: port,
      expectedSenderGoogleSub: planConfiguration.senderGoogleSub,
      allowlist,
    });
    expect(result.decision).toBe("succeeded");
    expect(result.record.dispatchStartedAt).toBe(now);
    expect(result.record.beforeState).toMatchObject({ approvedPlanVersion: plan.version, approvedPlanDigest: plan.digest });
    expect(result.record.afterState).toMatchObject({ receipt: result.receipt, recordedAt: now });
    expect(result.receipt).toEqual({ status: "sent", messageId: "gmail-message-s055", threadId: "gmail-thread-s055" });
    expect(port.messages[0]).toEqual(approvedMessage(plan));
    expect(replay).toMatchObject({ decision: "skipped", record: { status: "succeeded" }, receipt: result.receipt });
    expect(port.preparations).toBe(1);
    expect(port.attempts).toBe(1);
    expect(observedBefore).toMatchObject({ status: "in_progress", dispatchStartedAt: now, beforeState: { approvedPlanDigest: plan.digest } });
  });

  it("persists an explicit permanent provider rejection and never resends it", async () => {
    const { store, plan } = await createApproved();
    const port = new RecordingGmailPort();
    port.outcome = { status: "permanent_failed", providerCode: "http_403" };
    const first = await executeApprovedInitialGmail(executionInput(plan), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist });
    const replay = await executeApprovedInitialGmail(executionInput(plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist });
    expect(first).toMatchObject({ decision: "permanently_failed", reason: "provider_permanent_failure", record: { status: "permanently_failed", dispatchStartedAt: now }, receipt: { status: "permanent_failed" } });
    expect(replay).toMatchObject({ decision: "blocked", reason: "permanently_failed", record: { status: "permanently_failed" } });
    expect(port.attempts).toBe(1);
  });

  it("persists delivery uncertainty and blocks replay without a second handoff", async () => {
    const { store, plan } = await createApproved();
    const port = new RecordingGmailPort();
    port.outcome = { status: "delivery_uncertain", reason: "transport_timeout" };
    const first = await executeApprovedInitialGmail(executionInput(plan), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist });
    const replay = await executeApprovedInitialGmail(executionInput(plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist });
    expect(first).toMatchObject({ decision: "delivery_uncertain", reason: "delivery_uncertain", record: { status: "delivery_uncertain" }, receipt: { reason: "transport_timeout" } });
    expect(replay).toMatchObject({ decision: "blocked", reason: "delivery_uncertain", record: { status: "delivery_uncertain" } });
    expect(port.attempts).toBe(1);
  });

  it("keeps local preparation failures retryable with no dispatch marker", async () => {
    const { store, plan } = await createApproved();
    const port = new RecordingGmailPort();
    port.prepareFailure = new GmailProviderError();
    const failed = await executeApprovedInitialGmail(executionInput(plan), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist });
    expect(failed).toMatchObject({ decision: "retryable_failed", reason: "local_preparation", record: { status: "retryable_failed", dispatchStartedAt: null } });
    expect(port.attempts).toBe(0);
    port.prepareFailure = undefined;
    const retried = await executeApprovedInitialGmail(executionInput(plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist });
    expect(retried.decision).toBe("succeeded");
    expect(port.attempts).toBe(1);
  });

  it.each(driftCases)("fails closed for %s before preparation or handoff", async (_label, runtimeAllowlist, expectedSenderGoogleSub) => {
    const { store, plan } = await createApproved();
    const port = new RecordingGmailPort();
    const result = await executeApprovedInitialGmail(executionInput(plan), { executionStore: store, gmail: port, expectedSenderGoogleSub, allowlist: runtimeAllowlist });
    expect(result).toMatchObject({ decision: "blocked", record: { status: "conflict" } });
    expect(result.reason).toBe(_label);
    expect(port.preparations).toBe(0);
    expect(port.attempts).toBe(0);
  });

  it("treats a post-marker transport exception as uncertain", async () => {
    const { store, plan } = await createApproved();
    const port = new RecordingGmailPort();
    port.sendFailure = new Error("transport failed");
    const result = await executeApprovedInitialGmail(executionInput(plan), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist });
    expect(result).toMatchObject({ decision: "delivery_uncertain", record: { status: "delivery_uncertain", dispatchStartedAt: now }, receipt: { status: "delivery_uncertain", reason: "transport_error" } });
    expect(port.attempts).toBe(1);
  });

  it("reports the durable terminal Gmail outcome when a late writer wins the ledger race", async () => {
    const store = new LateTerminalGmailStore();
    const { plan } = await createApproved({ store });
    store.replaceNextSuccessfulGmailOutcome = true;
    const port = new RecordingGmailPort();
    const result = await executeApprovedInitialGmail(executionInput(plan), {
      executionStore: store,
      gmail: port,
      expectedSenderGoogleSub: planConfiguration.senderGoogleSub,
      allowlist,
    });
    expect(result).toMatchObject({
      decision: "delivery_uncertain",
      reason: "delivery_uncertain",
      record: { status: "delivery_uncertain" },
      receipt: { status: "delivery_uncertain", reason: "process_interrupted" },
    });
    expect(port.attempts).toBe(1);
  });

  it("returns busy for a duplicate click while the first send holds the lease", async () => {
    const { store, plan } = await createApproved();
    const port = new RecordingGmailPort();
    let release!: () => void;
    const sendStarted = new Promise<void>((resolve) => { port.onSend = () => { resolve(); }; });
    port.waitForRelease = new Promise<void>((resolve) => { release = resolve; });
    const firstPromise = executeApprovedInitialGmail(executionInput(plan), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist });
    await sendStarted;
    const duplicate = await executeApprovedInitialGmail(executionInput(plan, { now: "2026-07-16T12:00:30.000Z", leaseUntil: "2026-07-16T12:01:30.000Z" }), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist });
    release();
    const first = await firstPromise;
    expect(duplicate).toMatchObject({ decision: "busy", reason: "active_lease", record: { status: "in_progress" } });
    expect(first.decision).toBe("succeeded");
    expect(port.attempts).toBe(1);
  });

  it("does not hand off when Gmail before-state persistence fails", async () => {
    const store = new FailingGmailBeforeStore();
    const { plan } = await createApproved({ store });
    store.failGmailBefore = true;
    const port = new RecordingGmailPort();
    await expect(executeApprovedInitialGmail(executionInput(plan), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist })).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(port.attempts).toBe(0);
    expect((await store.listActions(plan.planId)).find((action) => action.actionKey === "initial.mail.notify")).toMatchObject({ status: "in_progress", dispatchStartedAt: now });
  });

  it("requires the successful reversible Calendar action before any Gmail preparation", async () => {
    const { store, plan } = await createApproved({ completeCalendar: false });
    const port = new RecordingGmailPort();
    await expect(executeApprovedInitialGmail(executionInput(plan), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist })).rejects.toMatchObject({ code: "invalid_task_state" });
    expect(port.preparations).toBe(0);
    expect(port.attempts).toBe(0);
  });

  it("refuses MCP execution before Gmail preparation", async () => {
    const { store, plan } = await createApproved();
    const port = new RecordingGmailPort();
    await expect(executeApprovedInitialGmail(executionInput(plan, { source: "mcp" }), { executionStore: store, gmail: port, expectedSenderGoogleSub: planConfiguration.senderGoogleSub, allowlist })).rejects.toMatchObject({ code: "forbidden" });
    expect(port.preparations).toBe(0);
  });
});
