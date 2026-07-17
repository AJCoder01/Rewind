import { describe, expect, it } from "vitest";
import {
  ActionExecutionRecordSchema,
  ApprovalRecordSchema,
  ExecutionPlanSchema,
  assertPlanPayloadDigest,
  computePlanPayloadDigest,
  type ExecutionPlan,
} from "@/lib/contracts/execution-persistence";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { MemoryExecutionPersistenceStore, type PlannedActionInput } from "@/lib/db/execution-store";
import { buildFixtureWorldPrRecord } from "@/lib/domain/fixture-world-pr";
import { createOpaqueId } from "@/lib/domain/ids";

function executionPlan(): ExecutionPlan {
  const record = buildFixtureWorldPrRecord("Move the Acme renewal meeting on 2026-08-20 to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees.", new Date("2026-07-16T00:00:00.000Z"));
  return ExecutionPlanSchema.parse({
    planId: record.planPayload.planId,
    taskId: record.planPayload.taskId,
    kind: "initial",
    version: record.planPayload.version,
    schemaVersion: record.planPayload.schemaVersion,
    promptVersion: record.planPayload.modelMetadata.promptVersion,
    model: record.planPayload.modelMetadata.model,
    payload: record.planPayload,
    digest: record.planPayload.digest,
    createdAt: "2026-07-16T00:00:00.000Z",
  });
}

function plannedActions(plan: ExecutionPlan): PlannedActionInput[] {
  const payloadActions = plan.payload.actions as unknown as readonly Record<string, unknown>[];
  return payloadActions.map((action) => {
    const target = action.target;
    const targetRef = target && typeof target === "object" && "providerEventId" in target
      ? String((target as { providerEventId: unknown }).providerEventId)
      : "account-brief";
    return {
      planId: plan.planId,
      actionKey: String(action.actionKey),
      type: String(action.type) as PlannedActionInput["type"],
      targetRef,
      action,
    };
  });
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeys(child)]));
  }
  return value;
}

describe("execution persistence contract", () => {
  it("reproduces the approved payload digest and rejects mutation", () => {
    const plan = executionPlan();
    expect(computePlanPayloadDigest(plan.payload)).toBe(plan.digest);
    expect(() => assertPlanPayloadDigest({ ...plan.payload, request: "mutated" }, plan.digest)).toThrow();
    expect(() => ApprovalRecordSchema.parse({
      approvalId: createOpaqueId("approval_"),
      planId: plan.planId,
      planVersion: plan.version,
      planDigest: plan.digest,
      actorId: "demo-operator",
      approvedAt: "2026-07-16T00:00:00.000Z",
      unexpected: true,
    })).toThrow();
  });

  it("keeps plans and approvals immutable and replays identical approval", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    await expect(store.createPlan(plan)).resolves.toEqual(plan);
    await expect(store.createPlan(plan)).resolves.toEqual(plan);
    await expect(store.createPlan({ ...plan, digest: `sha256:${"f".repeat(64)}` })).rejects.toThrow("Execution plan digest must match the immutable payload");
    const approval = ApprovalRecordSchema.parse({
      approvalId: createOpaqueId("approval_"),
      planId: plan.planId,
      planVersion: plan.version,
      planDigest: plan.digest,
      actorId: "demo-operator",
      approvedAt: "2026-07-16T00:00:00.000Z",
    });
    await expect(store.createApproval(approval)).resolves.toMatchObject({ replay: false });
    await expect(store.createApproval(approval)).resolves.toMatchObject({ replay: true });
    await expect(store.createApproval({ ...approval, actorId: "other-actor" })).rejects.toMatchObject({ code: "approval_conflict" });
    await expect(store.createApproval({ ...approval, planDigest: `sha256:${"f".repeat(64)}` })).rejects.toMatchObject({ code: "approval_conflict" });
  });

  it("treats reordered JSON object keys as the same immutable plan and action", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    const reorderedPlan = ExecutionPlanSchema.parse({ ...plan, payload: reverseObjectKeys(plan.payload) });
    await store.createPlan(plan);
    await expect(store.createPlan(reorderedPlan)).resolves.toEqual(plan);

    const actions = plannedActions(plan);
    const first = await store.ensureActionRows(actions);
    const reorderedActions = actions.map((action) => ({ ...action, action: reverseObjectKeys(action.action) as Record<string, unknown> }));
    await expect(store.ensureActionRows(reorderedActions)).resolves.toEqual(first);
  });

  it("creates one row per plan/action key and claims it only once at a time", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    await store.createPlan(plan);
    const actions = await store.ensureActionRows(plannedActions(plan));
    expect(actions).toHaveLength(3);
    await expect(store.ensureActionRows(plannedActions(plan))).resolves.toHaveLength(3);
    const calendar = actions.find((action) => action.type === "calendar.move");
    expect(calendar).toBeDefined();
    const claimed = await store.claimAction({
      actionExecutionId: calendar!.actionExecutionId,
      now: "2026-07-16T00:00:00.000Z",
      leaseUntil: "2026-07-16T00:01:00.000Z",
    });
    expect(claimed.claimed).toBe(true);
    const duplicate = await store.claimAction({
      actionExecutionId: calendar!.actionExecutionId,
      now: "2026-07-16T00:00:30.000Z",
      leaseUntil: "2026-07-16T00:02:00.000Z",
    });
    expect(duplicate.claimed).toBe(false);
    expect(duplicate.record.attempts).toBe(1);
    const expiredDuplicate = await store.claimAction({
      actionExecutionId: calendar!.actionExecutionId,
      now: "2026-07-16T00:02:00.000Z",
      leaseUntil: "2026-07-16T00:03:00.000Z",
    });
    expect(expiredDuplicate.claimed).toBe(false);
    const succeeded = await store.recordActionState({
      actionExecutionId: calendar!.actionExecutionId,
      status: "succeeded",
      now: "2026-07-16T00:00:10.000Z",
      claimFence: { attempts: claimed.record.attempts, leaseUntil: claimed.record.leaseUntil! },
      receipt: {
        provider: "google_calendar",
        operation: "move",
        providerEventId: "fixture-event-uk",
        resultingEtag: "etag-after",
        verified: true,
      },
    });
    expect(succeeded.status).toBe("succeeded");
    const lateConflict = await store.recordActionState({
      actionExecutionId: calendar!.actionExecutionId,
      status: "conflict",
      now: "2026-07-16T00:00:20.000Z",
      error: { code: "late_writer", retryable: false, safeMessage: "A stale writer attempted to replace the terminal outcome." },
    });
    expect(lateConflict).toEqual(succeeded);
    expect((await store.claimAction({
      actionExecutionId: calendar!.actionExecutionId,
      now: "2026-07-16T00:03:00.000Z",
      leaseUntil: "2026-07-16T00:04:00.000Z",
    })).claimed).toBe(false);
    expect(() => ActionExecutionRecordSchema.parse({ ...succeeded, receipt: undefined })).toThrow();
  });

  it("rejects a stale claim fence before returning a terminal row", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    await store.createPlan(plan);
    const calendar = (await store.ensureActionRows(plannedActions(plan))).find((action) => action.type === "calendar.move");
    expect(calendar).toBeDefined();
    const claim = await store.claimAction({
      actionExecutionId: calendar!.actionExecutionId,
      now: "2026-07-16T00:00:00.000Z",
      leaseUntil: "2026-07-16T00:01:00.000Z",
    });
    await expect(store.recordActionState({
      actionExecutionId: calendar!.actionExecutionId,
      status: "in_progress",
      now: "2026-07-16T00:01:30.000Z",
      claimFence: { attempts: claim.record.attempts, leaseUntil: claim.record.leaseUntil! },
      beforeState: { expiredPreparation: true },
    })).rejects.toMatchObject({ code: "action_not_claimable" });
    await store.recordActionState({
      actionExecutionId: calendar!.actionExecutionId,
      status: "conflict",
      now: "2026-07-16T00:01:30.000Z",
      claimFence: { attempts: claim.record.attempts, leaseUntil: claim.record.leaseUntil! },
      error: { code: "reconciliation_required", retryable: false, safeMessage: "The expired claim was reconciled without a provider retry." },
    });

    await expect(store.recordActionState({
      actionExecutionId: calendar!.actionExecutionId,
      status: "in_progress",
      now: "2026-07-16T00:01:31.000Z",
      claimFence: { attempts: claim.record.attempts, leaseUntil: claim.record.leaseUntil! },
      beforeState: { stalePreparation: true },
    })).rejects.toMatchObject({ code: "action_not_claimable" });
    await expect(store.getAction(calendar!.actionExecutionId)).resolves.toMatchObject({ status: "conflict" });
  });

  it("rolls back the entire in-memory action batch when a later row conflicts", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    await store.createPlan(plan);
    const actions = plannedActions(plan);
    await store.ensureActionRows(actions);
    const stagedOnly: PlannedActionInput = {
      ...actions[0],
      actionExecutionId: createOpaqueId("act_"),
      actionKey: "initial.artifact.atomicity_probe",
    };
    const conflicting: PlannedActionInput = {
      ...actions[1],
      action: { ...actions[1].action, adversarialMutation: true },
    };

    await expect(store.ensureActionRows([stagedOnly, conflicting])).rejects.toMatchObject({ code: "action_immutable_conflict" });
    expect((await store.listActions(plan.planId)).map((action) => action.actionKey)).not.toContain(stagedOnly.actionKey);
    expect(await store.listActions(plan.planId)).toHaveLength(actions.length);
  });

  it("rejects a stale completion after a later retry takes the action lease", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    await store.createPlan(plan);
    const actions = await store.ensureActionRows(plannedActions(plan));
    const artifact = actions.find((action) => action.type === "artifact.account_brief");
    expect(artifact).toBeDefined();

    const firstClaim = await store.claimAction({
      actionExecutionId: artifact!.actionExecutionId,
      now: "2026-07-16T00:00:00.000Z",
      leaseUntil: "2026-07-16T00:01:00.000Z",
    });
    await store.recordActionState({
      actionExecutionId: artifact!.actionExecutionId,
      status: "retryable_failed",
      now: "2026-07-16T00:00:10.000Z",
      claimFence: { attempts: firstClaim.record.attempts, leaseUntil: firstClaim.record.leaseUntil! },
      error: { code: "artifact_unavailable", retryable: true, safeMessage: "The artifact store was unavailable before persistence." },
    });
    const secondClaim = await store.claimAction({
      actionExecutionId: artifact!.actionExecutionId,
      now: "2026-07-16T00:02:00.000Z",
      leaseUntil: "2026-07-16T00:03:00.000Z",
    });
    const payload = VerifiedInitialPlanPayloadSchema.parse(plan.payload).actions[0];

    await expect(store.recordActionState({
      actionExecutionId: artifact!.actionExecutionId,
      status: "succeeded",
      now: "2026-07-16T00:02:10.000Z",
      claimFence: { attempts: firstClaim.record.attempts, leaseUntil: firstClaim.record.leaseUntil! },
      receipt: { artifactId: "fake-artifact-account-brief-v1", contentHash: payload.desired.contentHash, storedAt: "2026-07-16T00:02:10.000Z" },
    })).rejects.toMatchObject({ code: "action_not_claimable" });

    await expect(store.getAction(artifact!.actionExecutionId)).resolves.toMatchObject({ status: "in_progress", attempts: secondClaim.record.attempts });
  });

  it("rejects a Gmail receipt whose delivery state disagrees with the terminal action", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    await store.createPlan(plan);
    const actions = await store.ensureActionRows(plannedActions(plan));
    const mail = actions.find((action) => action.type === "mail.notify");
    expect(mail).toBeDefined();
    const claim = await store.claimAction({
      actionExecutionId: mail!.actionExecutionId,
      now: "2026-07-16T00:00:00.000Z",
      leaseUntil: "2026-07-16T00:01:00.000Z",
      dispatchStartedAt: "2026-07-16T00:00:00.001Z",
    });

    await expect(store.recordActionState({
      actionExecutionId: mail!.actionExecutionId,
      status: "succeeded",
      now: "2026-07-16T00:00:10.000Z",
      claimFence: { attempts: claim.record.attempts, leaseUntil: claim.record.leaseUntil! },
      receipt: { status: "delivery_uncertain", reason: "transport_timeout" },
    })).rejects.toMatchObject({ code: "action_immutable_conflict" });
  });

  it("persists repeated pre-handoff Gmail failures and drift without enabling a post-handoff retry", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    await store.createPlan(plan);
    const mail = (await store.ensureActionRows(plannedActions(plan))).find((action) => action.type === "mail.notify");
    expect(mail).toBeDefined();
    const firstFailure = await store.recordActionState({
      actionExecutionId: mail!.actionExecutionId,
      status: "retryable_failed",
      now: "2026-07-16T00:00:01.000Z",
      error: { code: "gmail_local_preparation_failed", retryable: true, safeMessage: "Gmail preparation failed before handoff." },
    });
    expect(firstFailure).toMatchObject({ status: "retryable_failed", attempts: 0, dispatchStartedAt: null });
    const repeatedFailure = await store.recordActionState({
      actionExecutionId: mail!.actionExecutionId,
      status: "retryable_failed",
      now: "2026-07-16T00:00:02.000Z",
      error: { code: "gmail_preparation_unavailable", retryable: true, safeMessage: "Gmail preparation remained unavailable before handoff." },
    });
    expect(repeatedFailure).toMatchObject({ status: "retryable_failed", attempts: 0, dispatchStartedAt: null });
    const drift = await store.recordActionState({
      actionExecutionId: mail!.actionExecutionId,
      status: "conflict",
      now: "2026-07-16T00:00:03.000Z",
      error: { code: "gmail_sender_not_allowed", retryable: false, safeMessage: "The approved Gmail configuration drifted before handoff." },
    });
    expect(drift).toMatchObject({ status: "conflict", dispatchStartedAt: null });

    const retryStore = new MemoryExecutionPersistenceStore();
    await retryStore.createPlan(plan);
    const retryMail = (await retryStore.ensureActionRows(plannedActions(plan))).find((action) => action.type === "mail.notify");
    const claim = await retryStore.claimAction({
      actionExecutionId: retryMail!.actionExecutionId,
      now: "2026-07-16T00:01:00.000Z",
      leaseUntil: "2026-07-16T00:02:00.000Z",
      dispatchStartedAt: "2026-07-16T00:01:00.001Z",
    });
    await expect(retryStore.recordActionState({
      actionExecutionId: retryMail!.actionExecutionId,
      status: "retryable_failed",
      now: "2026-07-16T00:01:01.000Z",
      claimFence: { attempts: claim.record.attempts, leaseUntil: claim.record.leaseUntil! },
      error: { code: "gmail_retry_after_handoff", retryable: true, safeMessage: "This retry must be rejected after handoff." },
    })).rejects.toMatchObject({ code: "action_not_claimable" });
    await expect(retryStore.getAction(retryMail!.actionExecutionId)).resolves.toMatchObject({ status: "in_progress", dispatchStartedAt: "2026-07-16T00:01:00.001Z" });
  });

  it("rejects malformed mail and non-mail ledger receipt/dispatch combinations", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    await store.createPlan(plan);
    const actions = await store.ensureActionRows(plannedActions(plan));
    const mail = actions.find((action) => action.type === "mail.notify")!;
    const calendar = actions.find((action) => action.type === "calendar.move")!;
    const finishedAt = "2026-07-16T00:00:10.000Z";
    const retryableMail = {
      ...mail,
      status: "retryable_failed" as const,
      finishedAt,
      error: { code: "gmail_local_preparation_failed", retryable: true, safeMessage: "Preparation failed before handoff." },
    };
    const driftedMail = {
      ...mail,
      status: "conflict" as const,
      finishedAt,
      error: { code: "gmail_configuration_drift", retryable: false, safeMessage: "Configuration drifted before handoff." },
    };
    expect(ActionExecutionRecordSchema.safeParse(retryableMail).success).toBe(true);
    expect(ActionExecutionRecordSchema.safeParse(driftedMail).success).toBe(true);

    const malformed = [
      { ...retryableMail, dispatchStartedAt: finishedAt },
      { ...driftedMail, receipt: { status: "delivery_uncertain", reason: "transport_timeout" } },
      {
        ...mail,
        status: "succeeded",
        attempts: 1,
        startedAt: "2026-07-16T00:00:00.000Z",
        finishedAt,
        dispatchStartedAt: finishedAt,
        receipt: { provider: "google_calendar", operation: "move", providerEventId: "fixture-event-uk", resultingEtag: "etag-after", verified: true },
      },
      { ...calendar, dispatchStartedAt: finishedAt },
      {
        ...calendar,
        status: "succeeded",
        attempts: 1,
        startedAt: "2026-07-16T00:00:00.000Z",
        finishedAt,
        receipt: { status: "sent", messageId: "gmail-message-wrong-type" },
      },
    ];
    for (const record of malformed) expect(ActionExecutionRecordSchema.safeParse(record).success).toBe(false);
  });

  it("rejects claim markers on the wrong action boundary without mutating the row", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    await store.createPlan(plan);
    const actions = await store.ensureActionRows(plannedActions(plan));
    const mail = actions.find((action) => action.type === "mail.notify")!;
    const calendar = actions.find((action) => action.type === "calendar.move")!;
    await expect(store.claimAction({
      actionExecutionId: mail.actionExecutionId,
      now: "2026-07-16T00:00:00.000Z",
      leaseUntil: "2026-07-16T00:01:00.000Z",
    })).rejects.toMatchObject({ code: "action_not_claimable" });
    await expect(store.claimAction({
      actionExecutionId: calendar.actionExecutionId,
      now: "2026-07-16T00:00:00.000Z",
      leaseUntil: "2026-07-16T00:01:00.000Z",
      dispatchStartedAt: "2026-07-16T00:00:00.001Z",
    })).rejects.toMatchObject({ code: "action_not_claimable" });
    await expect(store.getAction(mail.actionExecutionId)).resolves.toMatchObject({ status: "planned", attempts: 0 });
    await expect(store.getAction(calendar.actionExecutionId)).resolves.toMatchObject({ status: "planned", attempts: 0 });
  });

  it("marks expired leases with durable fail-closed outcomes", async () => {
    const store = new MemoryExecutionPersistenceStore();
    const plan = executionPlan();
    await store.createPlan(plan);
    const actions = await store.ensureActionRows(plannedActions(plan));
    const mail = actions.find((action) => action.type === "mail.notify");
    const calendar = actions.find((action) => action.type === "calendar.move");
    expect(mail && calendar).toBeTruthy();
    await store.claimAction({ actionExecutionId: mail!.actionExecutionId, now: "2026-07-16T00:00:00.000Z", leaseUntil: "2026-07-16T00:01:00.000Z", dispatchStartedAt: "2026-07-16T00:00:00.001Z" });
    const uncertain = await store.reconcileExpiredLease(mail!.actionExecutionId, "2026-07-16T00:02:00.000Z");
    expect(uncertain.status).toBe("delivery_uncertain");
    expect(uncertain.receipt).toMatchObject({ status: "delivery_uncertain", reason: "process_interrupted" });
    await store.claimAction({ actionExecutionId: calendar!.actionExecutionId, now: "2026-07-16T00:00:00.000Z", leaseUntil: "2026-07-16T00:01:00.000Z" });
    const conflict = await store.reconcileExpiredLease(calendar!.actionExecutionId, "2026-07-16T00:02:00.000Z");
    expect(conflict.status).toBe("conflict");
    expect(conflict.error).toMatchObject({ code: "reconciliation_required", retryable: false });
    expect(conflict.leaseUntil).toBeNull();
  });

  it("requires an existing plan before creating action ledger rows", async () => {
    const store = new MemoryExecutionPersistenceStore();
    await expect(store.ensureActionRows([{
      planId: createOpaqueId("plan_"),
      actionKey: "initial.artifact.account_brief",
      type: "artifact.account_brief",
      targetRef: "artifact:account-brief",
      action: {},
    }])).rejects.toMatchObject({ code: "plan_not_found" });
  });
});
