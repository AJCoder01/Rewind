import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as approveInitialPlanRoute } from "@/app/api/v1/world-prs/[worldPrId]/approvals/initial/route";
import { createSessionValue } from "@/lib/auth/session";
import { memoryExecutionStore } from "@/lib/db";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { StoreError } from "@/lib/db/store";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { sha256Digest } from "@/lib/domain/digest";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";
import { approveInitialPlan, replanInitialPlan, supersedeInitialPlanPayload } from "@/lib/services/initial-approval";
import { cancelWorldPr, createWorldPr } from "@/lib/services/world-pr";

const request = SUPPORTED_SCENARIO_REQUEST;
const fixedNow = () => new Date("2026-07-16T12:00:00.000Z");
const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  APP_BASE_URL: process.env.APP_BASE_URL,
  REWIND_STORAGE_MODE: process.env.REWIND_STORAGE_MODE,
  REWIND_SESSION_SECRET: process.env.REWIND_SESSION_SECRET,
  MCP_BACKEND_TOKEN: process.env.MCP_BACKEND_TOKEN,
};

async function createPreview(actorId = "test:operator") {
  const created = await createWorldPr({
    actorId,
    source: "dashboard",
    idempotencyKey: `create-${actorId.replace(/[^a-z0-9]/gi, "-")}-0001`,
    request: { request },
  });
  if (!created.view.activePlan || created.view.activePlan.pointer.kind !== "initial") throw new Error("Expected an initial preview.");
  return { created, pointer: created.view.activePlan.pointer };
}

async function approve(worldPrId: string, pointer: { planId: string; kind: "initial"; version: number; digest: string }, actorId = "test:operator") {
  return approveInitialPlan({
    actorId,
    source: "dashboard",
    idempotencyKey: `approve-${pointer.version}-${actorId.replace(/[^a-z0-9]/gi, "-")}-0001`,
    requestId: "req_s051_test_0001",
    worldPrId,
    request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
  }, { now: fixedNow });
}

describe("S051 initial approval, cancellation, and replan", () => {
  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.REWIND_STORAGE_MODE = "memory_fixture";
    process.env.REWIND_SESSION_SECRET = "s051-route-session-secret-that-is-long-enough-0001";
    process.env.MCP_BACKEND_TOKEN = "s051-route-mcp-token-that-is-long-enough-0001";
    memoryFixtureStore.clear();
    memoryExecutionStore.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key as keyof typeof process.env];
      else process.env[key as keyof typeof process.env] = value;
    }
  });

  it("stores the exact actor/time/version/digest approval and prepares three planned action rows", async () => {
    const { created, pointer } = await createPreview();
    const result = await approve(created.response.worldPrId, pointer);

    expect(result.replay).toBe(false);
    expect(result.response).toMatchObject({ worldPrId: created.response.worldPrId, status: "preview_ready", activePlan: pointer });
    const plan = await memoryExecutionStore.getPlan(pointer.planId);
    expect(plan).toMatchObject({ planId: pointer.planId, taskId: created.response.worldPrId, version: pointer.version, digest: pointer.digest });
    await expect(memoryExecutionStore.getApproval(pointer.planId)).resolves.toMatchObject({
      planId: pointer.planId,
      planVersion: pointer.version,
      planDigest: pointer.digest,
      actorId: "test:operator",
      approvedAt: fixedNow().toISOString(),
    });
    const actionRows = await memoryExecutionStore.listActions(pointer.planId);
    expect(actionRows).toHaveLength(3);
    expect(actionRows.map((action) => action.actionKey)).toEqual([
      "initial.artifact.account_brief",
      "initial.calendar.move",
      "initial.mail.notify",
    ]);
    expect(actionRows.every((action) => action.status === "planned")).toBe(true);
    expect(result.view.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "approval.recorded", label: "Initial plan approved; no external action has started.", status: "preview_ready" }),
    ]));
  });

  it("replays an identical approval without a second approval or timeline entry", async () => {
    const { created, pointer } = await createPreview();
    const first = await approve(created.response.worldPrId, pointer);
    const replay = await approveInitialPlan({
      actorId: "test:operator",
      source: "dashboard",
      idempotencyKey: "approve-replay-with-new-key-0001",
      requestId: "req_s051_test_0002",
      worldPrId: created.response.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
    }, { now: () => new Date("2026-07-16T12:05:00.000Z") });

    expect(replay.replay).toBe(true);
    expect(replay.view.timeline.filter((item) => item.type === "approval.recorded")).toHaveLength(1);
    expect(replay.response.replayPending).toBeUndefined();
    expect(replay.response.activePlan).toEqual(first.response.activePlan);
  });

  it("recovers a pending approval key when the approval persisted before its timeline update failed", async () => {
    const { created, pointer } = await createPreview();
    const input = {
      actorId: "test:operator",
      source: "dashboard" as const,
      idempotencyKey: "approve-recover-pending-0001",
      requestId: "req_s051_recover_pending_0001",
      worldPrId: created.response.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
    };
    vi.spyOn(memoryFixtureStore, "updateView").mockRejectedValueOnce(new StoreError("internal_error", "timeline storage failed"));

    await expect(approveInitialPlan(input, { now: fixedNow })).rejects.toMatchObject({ code: "internal_error" });
    await expect(memoryExecutionStore.getApproval(pointer.planId)).resolves.toMatchObject({ actorId: "test:operator" });

    const replay = await approveInitialPlan({ ...input, requestId: "req_s051_recover_pending_0002" }, { now: fixedNow });
    expect(replay).toMatchObject({ replay: true, view: { worldPrId: created.response.worldPrId } });
    expect(replay.view.timeline.filter((item) => item.type === "approval.recorded")).toHaveLength(1);
  });

  it("returns a replay-pending response without entering a second approval mutation", async () => {
    const { created, pointer } = await createPreview();
    const input = {
      actorId: "test:operator",
      source: "dashboard" as const,
      idempotencyKey: "approve-pending-replay-0001",
      requestId: "req_s051_pending_replay_0001",
      worldPrId: created.response.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
    };
    await memoryFixtureStore.claimMutation({
      actorId: input.actorId,
      endpoint: `POST /api/v1/world-prs/${input.worldPrId}/approvals/initial`,
      idempotencyKey: input.idempotencyKey,
      bodyHash: sha256Digest({ worldPrId: input.worldPrId, request: input.request }),
      worldPrId: input.worldPrId,
      requestId: input.requestId,
      claimedAt: fixedNow().toISOString(),
    });

    const pending = await approveInitialPlan(input, { now: fixedNow });
    expect(pending).toMatchObject({ replay: true, response: { replayPending: true, worldPrId: created.response.worldPrId } });
    await expect(memoryExecutionStore.getApproval(pointer.planId)).resolves.toBeNull();
  });

  it("fences pending-mutation recovery to the active claim token after lease reclamation", async () => {
    const { created, pointer } = await createPreview();
    const mutation = {
      actorId: "test:operator",
      endpoint: `POST /api/v1/world-prs/${created.response.worldPrId}/approvals/initial`,
      idempotencyKey: "approve-claim-fence-recovery-0001",
      bodyHash: sha256Digest({
        worldPrId: created.response.worldPrId,
        request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
      }),
      worldPrId: created.response.worldPrId,
      requestId: "req_s051_claim_fence_0001",
      claimedAt: fixedNow().toISOString(),
    };
    const first = await memoryFixtureStore.claimMutation(mutation);
    if (first.kind !== "claimed") throw new Error("Expected the initial mutation claim.");
    const reclaimed = await memoryFixtureStore.claimMutation({
      ...mutation,
      requestId: "req_s051_claim_fence_0002",
      claimedAt: "2026-07-16T12:01:00.000Z",
    });
    if (reclaimed.kind !== "claimed") throw new Error("Expected the expired mutation claim to be reclaimed.");
    const response = {
      worldPrId: created.response.worldPrId,
      status: "preview_ready" as const,
      activePlan: pointer,
      requestId: mutation.requestId,
    };

    await expect(memoryFixtureStore.recoverMutation({ ...mutation, claimToken: first.claimToken }, response)).rejects.toMatchObject({ code: "internal_error" });
    await memoryFixtureStore.recoverMutation({ ...mutation, requestId: "req_s051_claim_fence_0002", claimedAt: "2026-07-16T12:01:00.000Z", claimToken: reclaimed.claimToken }, response);
    await expect(memoryFixtureStore.claimMutation({ ...mutation, requestId: "req_s051_claim_fence_0003", claimedAt: "2026-07-16T12:01:01.000Z" })).resolves.toMatchObject({ kind: "replay_completed", response });
  });

  it("rejects stale pointers, a different approver, and MCP approval attempts", async () => {
    const { created, pointer } = await createPreview("demo-operator");
    await approve(created.response.worldPrId, pointer, "demo-operator");

    await expect(approveInitialPlan({
      actorId: "demo-operator",
      source: "dashboard",
      idempotencyKey: "approve-stale-pointer-0001",
      worldPrId: created.response.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: `sha256:${"f".repeat(64)}` },
    })).rejects.toMatchObject({ code: "plan_digest_mismatch" });

    await expect(approveInitialPlan({
      actorId: "mcp:scoped-token",
      source: "dashboard",
      idempotencyKey: "approve-different-actor-0001",
      worldPrId: created.response.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
    })).rejects.toMatchObject({ code: "forbidden" });

    await expect(approveInitialPlan({
      actorId: "demo-operator",
      source: "mcp",
      idempotencyKey: "approve-mcp-forbidden-0001",
      worldPrId: created.response.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
    })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("does not release the scenario lock when an approved preview is cancelled", async () => {
    const { created, pointer } = await createPreview();
    await approve(created.response.worldPrId, pointer);
    await expect(cancelWorldPr({
      actorId: "test:operator",
      source: "dashboard",
      idempotencyKey: "cancel-approved-preview-0001",
      worldPrId: created.response.worldPrId,
      request: {},
    })).rejects.toMatchObject({ code: "invalid_task_state" });
    expect(memoryFixtureStore.hasScenarioLock()).toBe(true);
  });

  it("supersedes an unapproved preview immutably and leaves the old plan addressable", async () => {
    const { created, pointer } = await createPreview();
    const result = await replanInitialPlan({
      actorId: "test:operator",
      source: "dashboard",
      idempotencyKey: "replan-preview-0000001",
      requestId: "req_s051_test_0003",
      worldPrId: created.response.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
    }, { now: fixedNow });

    expect(result.view.activePlan?.pointer.version).toBe(2);
    expect(result.view.activePlan?.pointer.planId).not.toBe(pointer.planId);
    await expect(memoryFixtureStore.getInitialPlanPayload(created.response.worldPrId, pointer.planId)).resolves.toMatchObject({ planId: pointer.planId, version: 1 });
    const replacement = await memoryFixtureStore.getInitialPlanPayload(created.response.worldPrId, result.view.activePlan!.pointer.planId);
    expect(replacement).toMatchObject({ taskId: created.response.worldPrId, version: 2 });
    expect(await memoryExecutionStore.getApproval(pointer.planId)).toBeNull();
    expect(result.view.timeline.at(-1)).toMatchObject({ type: "plan.superseded", status: "preview_ready" });
  });

  it("durably replays a replan key after the active pointer changes and rejects a changed body", async () => {
    const { created, pointer } = await createPreview();
    const input = {
      actorId: "test:operator",
      source: "dashboard" as const,
      idempotencyKey: "replan-idempotency-replay-0001",
      requestId: "req_s051_replan_idempotency_0001",
      worldPrId: created.response.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
    };
    const first = await replanInitialPlan(input, { now: fixedNow });
    const replay = await replanInitialPlan({ ...input, requestId: "req_s051_replan_idempotency_0002" }, { now: fixedNow });

    expect(replay.replay).toBe(true);
    expect(replay.response).toEqual(first.response);
    expect(replay.view.activePlan?.pointer).toEqual(first.view.activePlan?.pointer);
    await expect(replanInitialPlan({
      ...input,
      request: { ...input.request, planDigest: `sha256:${"f".repeat(64)}` },
    }, { now: fixedNow })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("does not credit a pending replan to a different replacement payload", async () => {
    const { created, pointer } = await createPreview();
    const input = {
      actorId: "test:operator",
      source: "dashboard" as const,
      idempotencyKey: "replan-pending-distinct-target-0001",
      requestId: "req_s051_pending_replan_0001",
      worldPrId: created.response.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
    };
    await memoryFixtureStore.claimMutation({
      actorId: input.actorId,
      endpoint: `POST /api/v1/world-prs/${input.worldPrId}/plans/initial/refresh`,
      idempotencyKey: input.idempotencyKey,
      bodyHash: sha256Digest({ worldPrId: input.worldPrId, request: input.request }),
      worldPrId: input.worldPrId,
      requestId: input.requestId,
      claimedAt: fixedNow().toISOString(),
    });
    const currentPayload = await memoryFixtureStore.getInitialPlanPayload(created.response.worldPrId, pointer.planId);
    if (!currentPayload) throw new Error("Expected the original immutable plan.");
    const differentReplacement = supersedeInitialPlanPayload(currentPayload, "plan_s051_distinct_pending_replan_01");
    await replanInitialPlan({
      ...input,
      idempotencyKey: "replan-distinct-target-winner-0001",
      requestId: "req_s051_distinct_winner_0001",
      nextPayload: differentReplacement,
    }, { now: fixedNow });

    const pending = await replanInitialPlan({ ...input, requestId: "req_s051_pending_replan_0002" }, { now: fixedNow });
    expect(pending).toMatchObject({ replay: true, response: { replayPending: true } });
    expect(pending.view.activePlan?.pointer.planId).toBe(differentReplacement.planId);
  });

  it("rejects replan after approval and keeps the approved version authoritative", async () => {
    const { created, pointer } = await createPreview();
    await approve(created.response.worldPrId, pointer);
    await expect(replanInitialPlan({
      actorId: "test:operator",
      source: "dashboard",
      idempotencyKey: "replan-after-approval-0001",
      worldPrId: created.response.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
    })).rejects.toMatchObject({ code: "invalid_task_state" });
    await expect(memoryFixtureStore.getInitialPlanPayload(created.response.worldPrId, pointer.planId)).resolves.toMatchObject({ planId: pointer.planId, version: 1 });
  });

  it("recomputes the replacement digest and rejects tampered replacement content", async () => {
    const { created } = await createPreview();
    const original = await memoryFixtureStore.getInitialPlanPayload(created.response.worldPrId, created.view.activePlan!.pointer.planId);
    if (!original) throw new Error("Expected the fixture plan payload.");
    const replacement = supersedeInitialPlanPayload(original, "plan_s051_replacement_0001");
    const { digest, ...core } = replacement;
    expect(sha256Digest(core)).toBe(digest);
    expect(() => VerifiedInitialPlanPayloadSchema.parse({ ...replacement, request: "tampered", digest })).toThrow();
  });

  it("keeps approval dashboard-only at the HTTP boundary", async () => {
    const { created, pointer } = await createPreview("demo-operator");
    const session = createSessionValue("demo-operator");
    const body = JSON.stringify({ planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest });
    const dashboardResponse = await approveInitialPlanRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.response.worldPrId}/approvals/initial`, {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `rewind_session=${session}; rewind_csrf=s051-csrf-token`,
        "x-rewind-csrf": "s051-csrf-token",
        "content-type": "application/json",
        "idempotency-key": "s051-route-approval-0001",
      },
      body,
    }), { params: Promise.resolve({ worldPrId: created.response.worldPrId }) });
    expect(dashboardResponse.status).toBe(200);
    await expect(dashboardResponse.json()).resolves.toMatchObject({ worldPrId: created.response.worldPrId, status: "preview_ready" });

    const mcpResponse = await approveInitialPlanRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.response.worldPrId}/approvals/initial`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.MCP_BACKEND_TOKEN}`,
        "content-type": "application/json",
        "idempotency-key": "s051-route-mcp-approval-0001",
      },
      body,
    }), { params: Promise.resolve({ worldPrId: created.response.worldPrId }) });
    expect(mcpResponse.status).toBe(401);
    await expect(mcpResponse.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });
});
