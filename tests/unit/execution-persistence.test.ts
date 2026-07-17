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
