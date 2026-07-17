import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { ArtifactProviderError, FakeArtifactPort, PostgresArtifactPort, type ArtifactPort } from "@/lib/adapters/artifact";
import { ArtifactReceiptSchema, type AccountBriefArtifactInput } from "@/lib/contracts/provider-ports";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { memoryExecutionStore } from "@/lib/db";
import { ExecutionPersistenceError, MemoryExecutionPersistenceStore } from "@/lib/db/execution-store";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";
import { approveInitialPlan } from "@/lib/services/initial-approval";
import { executeApprovedInitialArtifact } from "@/lib/services/initial-artifact-execution";
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
    idempotencyKey: "s053-create-preview-0001",
    request: { request },
  });
  if (!created.view.activePlan || created.view.activePlan.pointer.kind !== "initial") throw new Error("Expected an initial plan.");
  const pointer = created.view.activePlan.pointer;
  await approveInitialPlan({
    actorId: "test:operator",
    source: "dashboard",
    idempotencyKey: "s053-approve-preview-0001",
    requestId: "req_s053_test_0001",
    worldPrId: created.response.worldPrId,
    request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
  }, { now: () => new Date(now) });
  const plan = await memoryExecutionStore.getPlan(pointer.planId);
  if (!plan) throw new Error("Expected the approved execution plan.");
  return { created, pointer, plan };
}

function executionInput(plan: { planId: string; digest: string }, overrides: Record<string, string> = {}) {
  return {
    actorId: "test:operator",
    source: "dashboard" as const,
    planId: plan.planId,
    planDigest: plan.digest,
    now: overrides.now ?? now,
    leaseUntil: overrides.leaseUntil ?? "2026-07-16T12:01:00.000Z",
  };
}

function artifactFromPlan(plan: { payload: unknown }): AccountBriefArtifactInput {
  return VerifiedInitialPlanPayloadSchema.parse(plan.payload).actions[0].desired;
}

describe("S053 exact approved artifact execution", () => {
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

  it("persists the exact planned bytes only after durable before-state and records the typed receipt", async () => {
    const { plan, pointer } = await createApproved();
    const fake = new FakeArtifactPort({ storedAt: "2026-07-16T12:00:01.000Z" });
    let calls = 0;
    let observedBeforeCall: Awaited<ReturnType<typeof memoryExecutionStore.getAction>> | undefined;
    const port: ArtifactPort = {
      persistApprovedAccountBrief: async (input) => {
        calls += 1;
        observedBeforeCall = await memoryExecutionStore.getAction((await memoryExecutionStore.listActions(pointer.planId))[0].actionExecutionId);
        return fake.persistApprovedAccountBrief(input);
      },
    };

    const result = await executeApprovedInitialArtifact(executionInput(plan), { executionStore: memoryExecutionStore, artifactPort: port });
    const approved = artifactFromPlan(plan);
    expect(result.decision).toBe("succeeded");
    expect(result.record.status).toBe("succeeded");
    expect(result.receipt).toEqual({ artifactId: "fake-artifact-account-brief-v1", contentHash: approved.contentHash, storedAt: "2026-07-16T12:00:01.000Z" });
    expect(fake.getSavedForTest()).toEqual(approved);
    expect(calls).toBe(1);
    if (!observedBeforeCall) throw new Error("Expected the action row to be visible before artifact persistence.");
    expect(observedBeforeCall).toMatchObject({
      status: "in_progress",
      beforeState: {
        contentHash: approved.contentHash,
        sourceDigest: approved.provenance.sourceDigest,
      },
    });
    expect(observedBeforeCall).not.toHaveProperty("afterState");
    expect(observedBeforeCall).not.toHaveProperty("receipt");
    expect(result.record.afterState).toEqual(result.receipt);

    const replay = await executeApprovedInitialArtifact(executionInput(plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: memoryExecutionStore, artifactPort: port });
    expect(replay.decision).toBe("skipped");
    expect(replay.record.actionExecutionId).toBe(result.record.actionExecutionId);
    expect(calls).toBe(1);
  });

  it("records known artifact-store unavailability as retryable and succeeds on an explicit retry with the same bytes", async () => {
    const { plan } = await createApproved();
    const unavailable = new FakeArtifactPort({ failure: "unavailable" });
    const first = await executeApprovedInitialArtifact(executionInput(plan), { executionStore: memoryExecutionStore, artifactPort: unavailable });
    expect(first).toMatchObject({ decision: "retryable_failed", reason: "artifact_unavailable", record: { status: "retryable_failed" } });
    expect(first.record.beforeState).toMatchObject({ contentHash: artifactFromPlan(plan).contentHash });
    expect(first.record.afterState).toBeUndefined();

    const healthy = new FakeArtifactPort({ storedAt: "2026-07-16T12:02:01.000Z" });
    const second = await executeApprovedInitialArtifact(executionInput(plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: memoryExecutionStore, artifactPort: healthy });
    expect(second.decision).toBe("succeeded");
    expect(healthy.getSavedForTest()).toEqual(artifactFromPlan(plan));
    expect(second.record.attempts).toBe(2);
  });

  it("stops invalid artifact persistence permanently and refuses a later retry", async () => {
    const { plan } = await createApproved();
    const rejected = await executeApprovedInitialArtifact(executionInput(plan), { executionStore: memoryExecutionStore, artifactPort: new FakeArtifactPort({ failure: "validation_failure" }) });
    expect(rejected).toMatchObject({ decision: "permanently_failed", reason: "artifact_invalid", record: { status: "permanently_failed" } });

    const replay = await executeApprovedInitialArtifact(executionInput(plan, { now: "2026-07-16T12:02:00.000Z", leaseUntil: "2026-07-16T12:03:00.000Z" }), { executionStore: memoryExecutionStore, artifactPort: new FakeArtifactPort() });
    expect(replay).toMatchObject({ decision: "blocked", reason: "permanently_failed", record: { status: "permanently_failed" } });
  });

  it("fails closed when a provider returns a receipt for different bytes", async () => {
    const { plan } = await createApproved();
    const approved = artifactFromPlan(plan);
    const mismatch: ArtifactPort = {
      persistApprovedAccountBrief: async () => ArtifactReceiptSchema.parse({ artifactId: "fake-wrong-artifact-v1", contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", storedAt: now }),
    };
    const result = await executeApprovedInitialArtifact(executionInput(plan), { executionStore: memoryExecutionStore, artifactPort: mismatch });
    expect(result).toMatchObject({ decision: "conflict", reason: "artifact_persistence_uncertain", record: { status: "conflict" } });
    expect(result.record.beforeState).toMatchObject({ contentHash: approved.contentHash });
    expect(result.record.afterState).toBeUndefined();
  });

  it("does not call the artifact port when before-state persistence fails", async () => {
    const { plan } = await createApproved();
    class FailingBeforeStateStore extends MemoryExecutionPersistenceStore {
      private fail = true;

      override async recordActionState(input: Parameters<MemoryExecutionPersistenceStore["recordActionState"]>[0]) {
        if (this.fail && input.status === "in_progress") {
          this.fail = false;
          throw new ExecutionPersistenceError("persistence_failure", "before-state write failed");
        }
        return super.recordActionState(input);
      }
    }
    const store = new FailingBeforeStateStore();
    const approvedPlan = await store.createPlan(plan);
    await store.createApproval({
      approvalId: "appr_s053_before_state",
      planId: approvedPlan.planId,
      planVersion: approvedPlan.version,
      planDigest: approvedPlan.digest,
      actorId: "test:operator",
      approvedAt: now,
    });
    await store.ensureActionRows((await memoryExecutionStore.listActions(plan.planId)).map((action) => ({
      ...action,
      actionExecutionId: undefined,
      operationKey: action.operationKey,
    })));
    let calls = 0;
    const port: ArtifactPort = { persistApprovedAccountBrief: async (input) => { calls += 1; return new FakeArtifactPort().persistApprovedAccountBrief(input); } };
    await expect(executeApprovedInitialArtifact(executionInput(plan), { executionStore: store, artifactPort: port })).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(calls).toBe(0);
  });

  it("keeps PostgreSQL artifact persistence immutable and idempotent by task-scoped artifact ID", async () => {
    const approved = {
      title: "Acme parent-account risk brief",
      content: "- Shared adoption risk, but executive sponsorship is pending.\n- Procurement needs a confirmed owner.\n- Next step: schedule a review.",
      contentHash: "sha256:3d0e4f7d89d3d13f9c3b3f78b9ee5e9d0047cc5dce5a4cb3f6d0af4e4e4a4b55",
      provenance: {
        sourceId: "acme_parent_account_notes" as const,
        sourceVersion: "controlled-content.v1" as const,
        sourceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        excludedDimensions: ["calendar_event", "region", "attendees", "meeting_time"] as const,
        validatorVersion: "artifact-independence.v1",
      },
    } satisfies AccountBriefArtifactInput;
    const validContentHash = (await import("@/lib/domain/digest")).sha256Text(approved.content);
    const exact = { ...approved, contentHash: validContentHash };
    const row = { id: "artifact_wpr_s053_db", task_id: "wpr_s053_db", kind: "account_brief", content: exact.content, content_hash: exact.contentHash, provenance: exact.provenance, created_at: "2026-07-16T12:00:01.000Z" };
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [row] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [row] });
    const port = new PostgresArtifactPort({ query } as unknown as Pool, { taskId: "wpr_s053_db", artifactId: "artifact_wpr_s053_db" });
    await expect(port.persistApprovedAccountBrief(exact)).resolves.toMatchObject({ artifactId: row.id, contentHash: exact.contentHash });
    await expect(port.persistApprovedAccountBrief(exact)).resolves.toMatchObject({ artifactId: row.id, contentHash: exact.contentHash });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("maps PostgreSQL persistence failure to an unavailable artifact provider outcome", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const port = new PostgresArtifactPort({ query } as unknown as Pool, { taskId: "wpr_s053_db" });
    const artifact = artifactFromPlan((await createApproved()).plan);
    await expect(port.persistApprovedAccountBrief(artifact)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(port.persistApprovedAccountBrief({ ...artifact, contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })).rejects.toBeInstanceOf(ArtifactProviderError);
  });
});
