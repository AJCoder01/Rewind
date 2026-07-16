import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryExecutionStore } from "@/lib/db";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";
import { approveInitialPlan } from "@/lib/services/initial-approval";
import { claimApprovedInitialAction, ensureInitialActionRows } from "@/lib/services/initial-execution";
import { createWorldPr } from "@/lib/services/world-pr";

const request = SUPPORTED_SCENARIO_REQUEST;
const now = "2026-07-16T12:00:00.000Z";
const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  APP_BASE_URL: process.env.APP_BASE_URL,
  REWIND_STORAGE_MODE: process.env.REWIND_STORAGE_MODE,
};

async function createApproved() {
  const created = await createWorldPr({
    actorId: "test:operator",
    source: "dashboard",
    idempotencyKey: "s052-create-preview-0001",
    request: { request },
  });
  if (!created.view.activePlan || created.view.activePlan.pointer.kind !== "initial") throw new Error("Expected an initial plan.");
  const pointer = created.view.activePlan.pointer;
  await approveInitialPlan({
    actorId: "test:operator",
    source: "dashboard",
    idempotencyKey: "s052-approve-preview-0001",
    requestId: "req_s052_test_0001",
    worldPrId: created.response.worldPrId,
    request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
  }, { now: () => new Date(now) });
  const plan = await memoryExecutionStore.getPlan(pointer.planId);
  if (!plan) throw new Error("Expected the approved execution plan.");
  return { created, pointer, plan };
}

function claimInput(plan: { planId: string; digest: string }, actionKey: "initial.artifact.account_brief" | "initial.calendar.move" | "initial.mail.notify", overrides: Record<string, string> = {}) {
  return {
    actorId: "test:operator",
    source: "dashboard" as const,
    planId: plan.planId,
    planDigest: plan.digest,
    actionKey,
    now: overrides.now ?? now,
    leaseUntil: overrides.leaseUntil ?? "2026-07-16T12:01:00.000Z",
    ...(overrides.dispatchStartedAt ? { dispatchStartedAt: overrides.dispatchStartedAt } : {}),
  };
}

describe("S052 initial durable action preparation and claim coordination", () => {
  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.REWIND_STORAGE_MODE = "memory_fixture";
    memoryFixtureStore.clear();
    memoryExecutionStore.clear();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key as keyof typeof process.env];
      else process.env[key as keyof typeof process.env] = value;
    }
  });

  it("creates exactly three durable planned rows before any dispatch and replays preparation", async () => {
    const { pointer } = await createApproved();
    const prepared = await ensureInitialActionRows(pointer.planId, memoryExecutionStore, { now: () => new Date(now) });
    expect(prepared.actions.map((action) => action.actionKey)).toEqual([
      "initial.artifact.account_brief",
      "initial.calendar.move",
      "initial.mail.notify",
    ]);
    expect(prepared.actions.every((action) => action.status === "planned" && action.attempts === 0)).toBe(true);
    await expect(memoryExecutionStore.listActions(pointer.planId)).resolves.toHaveLength(3);
    const replay = await ensureInitialActionRows(pointer.planId, memoryExecutionStore, { now: () => new Date("2026-07-16T12:02:00.000Z") });
    expect(replay.actions.map((action) => action.actionExecutionId)).toEqual(prepared.actions.map((action) => action.actionExecutionId));
  });

  it("claims an action once, reports an active lease as busy, and skips a succeeded action", async () => {
    const { plan } = await createApproved();
    const claimed = await claimApprovedInitialAction(claimInput(plan, "initial.artifact.account_brief"), memoryExecutionStore);
    expect(claimed.decision).toBe("claimed");
    expect(claimed.record.attempts).toBe(1);

    const busy = await claimApprovedInitialAction(claimInput(plan, "initial.artifact.account_brief", { now: "2026-07-16T12:00:30.000Z", leaseUntil: "2026-07-16T12:02:00.000Z" }), memoryExecutionStore);
    expect(busy.decision).toBe("busy");
    expect(busy.record.attempts).toBe(1);

    const payload = VerifiedInitialPlanPayloadSchema.parse(plan.payload);
    const artifact = await memoryExecutionStore.getAction(claimed.record.actionExecutionId);
    if (!artifact) throw new Error("Expected the claimed artifact row.");
    await memoryExecutionStore.recordActionState({
      actionExecutionId: artifact.actionExecutionId,
      status: "succeeded",
      now: "2026-07-16T12:00:10.000Z",
      receipt: {
        artifactId: "fake-artifact-account-brief-v1",
        contentHash: payload.actions[0].desired.contentHash,
        storedAt: "2026-07-16T12:00:10.000Z",
      },
    });
    const skipped = await claimApprovedInitialAction(claimInput(plan, "initial.artifact.account_brief", { now: "2026-07-16T12:03:00.000Z", leaseUntil: "2026-07-16T12:04:00.000Z" }), memoryExecutionStore);
    expect(skipped.decision).toBe("skipped");
    expect(skipped.record.status).toBe("succeeded");
  });

  it("allows retry only for an explicitly retryable failure and enforces fixed action order", async () => {
    const first = await createApproved();
    const artifact = (await memoryExecutionStore.listActions(first.pointer.planId)).find((action) => action.actionKey === "initial.artifact.account_brief");
    if (!artifact) throw new Error("Expected the artifact row.");
    await memoryExecutionStore.recordActionState({
      actionExecutionId: artifact.actionExecutionId,
      status: "retryable_failed",
      now: "2026-07-16T12:00:05.000Z",
      error: { code: "artifact_unavailable", retryable: true, safeMessage: "The artifact store was unavailable before persistence." },
    });
    const retried = await claimApprovedInitialAction(claimInput(first.plan, "initial.artifact.account_brief", { now: "2026-07-16T12:01:00.000Z", leaseUntil: "2026-07-16T12:02:00.000Z" }), memoryExecutionStore);
    expect(retried.decision).toBe("claimed");
    expect(retried.record.attempts).toBe(1);

    const second = await createApproved();
    await expect(claimApprovedInitialAction(claimInput(second.plan, "initial.calendar.move"), memoryExecutionStore)).rejects.toMatchObject({ code: "invalid_task_state" });
  });

  it("turns an expired Gmail lease into durable uncertainty and stops an expired Calendar lease for reconciliation", async () => {
    const mailRun = await createApproved();
    const mail = (await memoryExecutionStore.listActions(mailRun.pointer.planId)).find((action) => action.actionKey === "initial.mail.notify");
    if (!mail) throw new Error("Expected the mail row.");
    await memoryExecutionStore.claimAction({
      actionExecutionId: mail.actionExecutionId,
      now: "2026-07-16T12:00:00.000Z",
      leaseUntil: "2026-07-16T12:01:00.000Z",
      dispatchStartedAt: "2026-07-16T12:00:00.001Z",
    });
    const uncertain = await claimApprovedInitialAction(claimInput(mailRun.plan, "initial.mail.notify", {
      now: "2026-07-16T12:02:00.000Z",
      leaseUntil: "2026-07-16T12:03:00.000Z",
      dispatchStartedAt: "2026-07-16T12:02:00.001Z",
    }), memoryExecutionStore);
    expect(uncertain.decision).toBe("blocked");
    expect(uncertain.reason).toBe("delivery_uncertain");
    expect(uncertain.record.status).toBe("delivery_uncertain");

    const calendarRun = await createApproved();
    const calendar = (await memoryExecutionStore.listActions(calendarRun.pointer.planId)).find((action) => action.actionKey === "initial.calendar.move");
    if (!calendar) throw new Error("Expected the Calendar row.");
    await memoryExecutionStore.claimAction({
      actionExecutionId: calendar.actionExecutionId,
      now: "2026-07-16T12:00:00.000Z",
      leaseUntil: "2026-07-16T12:01:00.000Z",
    });
    const conflict = await claimApprovedInitialAction(claimInput(calendarRun.plan, "initial.calendar.move", {
      now: "2026-07-16T12:02:00.000Z",
      leaseUntil: "2026-07-16T12:03:00.000Z",
    }), memoryExecutionStore);
    expect(conflict.decision).toBe("blocked");
    expect(conflict.reason).toBe("reconciliation_required");
    expect(conflict.record.status).toBe("in_progress");
  });

  it("never retries terminal conflict or ambiguous actions", async () => {
    const { plan, pointer } = await createApproved();
    const calendar = (await memoryExecutionStore.listActions(pointer.planId)).find((action) => action.actionKey === "initial.calendar.move");
    if (!calendar) throw new Error("Expected the Calendar row.");
    await memoryExecutionStore.recordActionState({
      actionExecutionId: calendar.actionExecutionId,
      status: "conflict",
      now: "2026-07-16T12:00:10.000Z",
      error: { code: "provider_conflict", retryable: false, safeMessage: "Calendar state changed and requires a new preflight." },
    });
    const blocked = await claimApprovedInitialAction(claimInput(plan, "initial.calendar.move"), memoryExecutionStore);
    expect(blocked.decision).toBe("blocked");
    expect(blocked.reason).toBe("conflict");
    expect(blocked.record.attempts).toBe(0);
  });
});
