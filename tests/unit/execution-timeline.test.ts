import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as executionTimelineRoute } from "@/app/api/v1/world-prs/[worldPrId]/execution/route";
import { createSessionValue } from "@/lib/auth/session";
import { memoryExecutionStore } from "@/lib/db";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";
import { approveInitialPlan } from "@/lib/services/initial-approval";
import { getExecutionTimeline } from "@/lib/services/execution-timeline";
import { cancelWorldPr, createWorldPr } from "@/lib/services/world-pr";

const fixedNow = "2026-07-16T12:00:00.000Z";
const later = "2026-07-16T12:00:10.000Z";
const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  APP_BASE_URL: process.env.APP_BASE_URL,
  REWIND_STORAGE_MODE: process.env.REWIND_STORAGE_MODE,
  REWIND_SESSION_SECRET: process.env.REWIND_SESSION_SECRET,
  MCP_BACKEND_TOKEN: process.env.MCP_BACKEND_TOKEN,
};

async function createPreview(actorId = "demo-operator") {
  const created = await createWorldPr({
    actorId,
    source: "dashboard",
    idempotencyKey: `s056-create-${actorId.replace(/[^a-z0-9]/gi, "-")}-0001`,
    request: { request: SUPPORTED_SCENARIO_REQUEST },
  });
  if (!created.view.activePlan || created.view.activePlan.pointer.kind !== "initial") throw new Error("Expected an initial plan.");
  return { created, pointer: created.view.activePlan.pointer };
}

async function approvePreview(worldPrId: string, pointer: { planId: string; kind: "initial"; version: number; digest: string }) {
  return approveInitialPlan({
    actorId: "demo-operator",
    source: "dashboard",
    idempotencyKey: "s056-approve-preview-0001",
    requestId: "req_s056_test_0001",
    worldPrId,
    request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
  }, { now: () => new Date(fixedNow) });
}

async function action(planId: string, actionKey: string) {
  const record = (await memoryExecutionStore.listActions(planId)).find((candidate) => candidate.actionKey === actionKey);
  if (!record) throw new Error(`Expected action ${actionKey}.`);
  return record;
}

describe("S056 durable execution timeline", () => {
  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.REWIND_STORAGE_MODE = "memory_fixture";
    process.env.REWIND_SESSION_SECRET = "s056-route-session-secret-that-is-long-enough-0001";
    process.env.MCP_BACKEND_TOKEN = "s056-route-mcp-token-that-is-long-enough-0001";
    memoryFixtureStore.clear();
    memoryExecutionStore.clear();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key as keyof typeof process.env];
      else process.env[key as keyof typeof process.env] = value;
    }
  });

  it("shows an unapproved preview as awaiting approval without inventing action rows", async () => {
    const { created, pointer } = await createPreview();
    const timeline = await getExecutionTimeline(created.response.worldPrId, "demo-operator", { worldStore: memoryFixtureStore, executionStore: memoryExecutionStore });

    expect(timeline).toMatchObject({
      worldPrId: created.response.worldPrId,
      overallStatus: "awaiting_approval",
      planId: pointer.planId,
      planDigest: pointer.digest,
      actions: [],
    });
    expect(timeline?.message).toContain("No action ledger exists");
  });

  it("renders the fixed approved action order, lifecycle fields, and no false completion", async () => {
    const { created, pointer } = await createPreview();
    await approvePreview(created.response.worldPrId, pointer);
    const timeline = await getExecutionTimeline(created.response.worldPrId, "demo-operator", { worldStore: memoryFixtureStore, executionStore: memoryExecutionStore });

    expect(timeline?.overallStatus).toBe("not_started");
    expect(timeline?.actions.map((action) => action.actionKey)).toEqual([
      "initial.artifact.account_brief",
      "initial.calendar.move",
      "initial.mail.notify",
    ]);
    expect(timeline?.actions.map((action) => action.status)).toEqual(["planned", "planned", "planned"]);
    expect(timeline?.actions.map((action) => action.attempts)).toEqual([0, 0, 0]);
  });

  it("shows an active lease as in progress and preserves its durable timestamp", async () => {
    const { created, pointer } = await createPreview();
    await approvePreview(created.response.worldPrId, pointer);
    const artifact = await action(pointer.planId, "initial.artifact.account_brief");
    await memoryExecutionStore.claimAction({
      actionExecutionId: artifact.actionExecutionId,
      now: fixedNow,
      leaseUntil: "2026-07-16T12:01:00.000Z",
    });
    const timeline = await getExecutionTimeline(created.response.worldPrId, "demo-operator", { worldStore: memoryFixtureStore, executionStore: memoryExecutionStore });
    const artifactView = timeline?.actions[0];

    expect(timeline?.overallStatus).toBe("in_progress");
    expect(artifactView).toMatchObject({ status: "in_progress", attempts: 1, startedAt: fixedNow, finishedAt: null });
  });

  it("shows partial execution with a typed receipt and redacted conflict explanation", async () => {
    const { created, pointer } = await createPreview();
    await approvePreview(created.response.worldPrId, pointer);
    const plan = await memoryExecutionStore.getPlan(pointer.planId);
    if (!plan) throw new Error("Expected the durable plan.");
    const payload = VerifiedInitialPlanPayloadSchema.parse(plan.payload);
    const artifact = await action(pointer.planId, "initial.artifact.account_brief");
    const calendar = await action(pointer.planId, "initial.calendar.move");
    const artifactClaim = await memoryExecutionStore.claimAction({ actionExecutionId: artifact.actionExecutionId, now: fixedNow, leaseUntil: "2026-07-16T12:01:00.000Z" });
    await memoryExecutionStore.recordActionState({
      actionExecutionId: artifact.actionExecutionId,
      status: "succeeded",
      now: later,
      claimFence: { attempts: artifactClaim.record.attempts, leaseUntil: artifactClaim.record.leaseUntil! },
      receipt: { artifactId: "fake-artifact-account-brief-v1", contentHash: payload.actions[0].desired.contentHash, storedAt: later },
    });
    const calendarClaim = await memoryExecutionStore.claimAction({ actionExecutionId: calendar.actionExecutionId, now: fixedNow, leaseUntil: "2026-07-16T12:01:00.000Z" });
    await memoryExecutionStore.recordActionState({
      actionExecutionId: calendar.actionExecutionId,
      status: "conflict",
      now: later,
      claimFence: { attempts: calendarClaim.record.attempts, leaseUntil: calendarClaim.record.leaseUntil! },
      error: { code: "provider_conflict", retryable: false, safeMessage: "Calendar state changed and requires a new preflight." },
    });
    const timeline = await getExecutionTimeline(created.response.worldPrId, "demo-operator", { worldStore: memoryFixtureStore, executionStore: memoryExecutionStore });

    expect(timeline?.overallStatus).toBe("partial");
    expect(timeline?.actions[0].receipt).toMatchObject({ artifactId: "fake-artifact-account-brief-v1", contentHash: payload.actions[0].desired.contentHash });
    expect(timeline?.actions[1].error).toEqual({ code: "provider_conflict", retryable: false, safeMessage: "Calendar state changed and requires a new preflight." });
    expect(timeline?.actions[2].status).toBe("planned");
  });

  it("shows uncertain Gmail delivery as a stopping state and never completed", async () => {
    const { created, pointer } = await createPreview();
    await approvePreview(created.response.worldPrId, pointer);
    const plan = await memoryExecutionStore.getPlan(pointer.planId);
    if (!plan) throw new Error("Expected the durable plan.");
    const payload = VerifiedInitialPlanPayloadSchema.parse(plan.payload);
    const artifact = await action(pointer.planId, "initial.artifact.account_brief");
    const calendar = await action(pointer.planId, "initial.calendar.move");
    const mail = await action(pointer.planId, "initial.mail.notify");
    const artifactClaim = await memoryExecutionStore.claimAction({ actionExecutionId: artifact.actionExecutionId, now: fixedNow, leaseUntil: "2026-07-16T12:01:00.000Z" });
    await memoryExecutionStore.recordActionState({
      actionExecutionId: artifact.actionExecutionId,
      status: "succeeded",
      now: later,
      claimFence: { attempts: artifactClaim.record.attempts, leaseUntil: artifactClaim.record.leaseUntil! },
      receipt: { artifactId: "fake-artifact-account-brief-v1", contentHash: payload.actions[0].desired.contentHash, storedAt: later },
    });
    const calendarClaim = await memoryExecutionStore.claimAction({ actionExecutionId: calendar.actionExecutionId, now: fixedNow, leaseUntil: "2026-07-16T12:01:00.000Z" });
    await memoryExecutionStore.recordActionState({
      actionExecutionId: calendar.actionExecutionId,
      status: "succeeded",
      now: later,
      claimFence: { attempts: calendarClaim.record.attempts, leaseUntil: calendarClaim.record.leaseUntil! },
      receipt: { provider: "google_calendar", operation: "move", providerEventId: payload.actions[1].target.providerEventId, resultingEtag: "fixture-uk-etag-v2", verified: true },
    });
    const mailClaim = await memoryExecutionStore.claimAction({ actionExecutionId: mail.actionExecutionId, now: fixedNow, leaseUntil: "2026-07-16T12:01:00.000Z", dispatchStartedAt: later });
    await memoryExecutionStore.recordActionState({
      actionExecutionId: mail.actionExecutionId,
      status: "delivery_uncertain",
      now: later,
      claimFence: { attempts: mailClaim.record.attempts, leaseUntil: mailClaim.record.leaseUntil! },
      dispatchStartedAt: later,
      receipt: { status: "delivery_uncertain", reason: "transport_timeout" },
      error: { code: "gmail_delivery_uncertain", retryable: false, safeMessage: "The Gmail delivery outcome is uncertain and must not be automatically retried." },
    });
    const timeline = await getExecutionTimeline(created.response.worldPrId, "demo-operator", { worldStore: memoryFixtureStore, executionStore: memoryExecutionStore });

    expect(timeline?.overallStatus).toBe("partial");
    expect(timeline?.actions[2]).toMatchObject({ status: "delivery_uncertain", dispatchStartedAt: later, receipt: { reason: "transport_timeout" } });
  });

  it("reports completed only when all three action rows have verified terminal receipts", async () => {
    const { created, pointer } = await createPreview();
    await approvePreview(created.response.worldPrId, pointer);
    const plan = await memoryExecutionStore.getPlan(pointer.planId);
    if (!plan) throw new Error("Expected the durable plan.");
    const payload = VerifiedInitialPlanPayloadSchema.parse(plan.payload);
    const artifact = await action(pointer.planId, "initial.artifact.account_brief");
    const calendar = await action(pointer.planId, "initial.calendar.move");
    const mail = await action(pointer.planId, "initial.mail.notify");
    const artifactClaim = await memoryExecutionStore.claimAction({ actionExecutionId: artifact.actionExecutionId, now: fixedNow, leaseUntil: "2026-07-16T12:01:00.000Z" });
    await memoryExecutionStore.recordActionState({ actionExecutionId: artifact.actionExecutionId, status: "succeeded", now: later, claimFence: { attempts: artifactClaim.record.attempts, leaseUntil: artifactClaim.record.leaseUntil! }, receipt: { artifactId: "fake-artifact-account-brief-v1", contentHash: payload.actions[0].desired.contentHash, storedAt: later } });
    const calendarClaim = await memoryExecutionStore.claimAction({ actionExecutionId: calendar.actionExecutionId, now: fixedNow, leaseUntil: "2026-07-16T12:01:00.000Z" });
    await memoryExecutionStore.recordActionState({ actionExecutionId: calendar.actionExecutionId, status: "succeeded", now: later, claimFence: { attempts: calendarClaim.record.attempts, leaseUntil: calendarClaim.record.leaseUntil! }, receipt: { provider: "google_calendar", operation: "move", providerEventId: payload.actions[1].target.providerEventId, resultingEtag: "fixture-uk-etag-v2", verified: true } });
    const mailClaim = await memoryExecutionStore.claimAction({ actionExecutionId: mail.actionExecutionId, now: fixedNow, leaseUntil: "2026-07-16T12:01:00.000Z", dispatchStartedAt: later });
    await memoryExecutionStore.recordActionState({ actionExecutionId: mail.actionExecutionId, status: "succeeded", now: later, claimFence: { attempts: mailClaim.record.attempts, leaseUntil: mailClaim.record.leaseUntil! }, dispatchStartedAt: later, receipt: { status: "sent", messageId: "fake-gmail-message-1", threadId: "fake-gmail-thread-1" } });
    const inconsistent = await getExecutionTimeline(created.response.worldPrId, "demo-operator", { worldStore: memoryFixtureStore, executionStore: memoryExecutionStore });
    expect(inconsistent?.overallStatus).toBe("attention_required");
    const current = await memoryFixtureStore.get(created.response.worldPrId, "demo-operator");
    if (!current) throw new Error("Expected the durable task view.");
    await memoryFixtureStore.updateView(current.worldPrId, { ...current, status: "completed", updatedAt: later });
    const timeline = await getExecutionTimeline(created.response.worldPrId, "demo-operator", { worldStore: memoryFixtureStore, executionStore: memoryExecutionStore });

    expect(timeline?.overallStatus).toBe("completed");
    expect(timeline?.actions.every((action) => action.status === "succeeded" && action.receipt)).toBe(true);
  });

  it("shows cancelled lifecycle state without fabricating an execution ledger", async () => {
    const { created } = await createPreview();
    await cancelWorldPr({
      actorId: "demo-operator",
      source: "dashboard",
      idempotencyKey: "s056-cancel-preview-0001",
      worldPrId: created.response.worldPrId,
      request: {},
    });
    const timeline = await getExecutionTimeline(created.response.worldPrId, "demo-operator", { worldStore: memoryFixtureStore, executionStore: memoryExecutionStore });

    expect(timeline).toMatchObject({ taskStatus: "cancelled", overallStatus: "cancelled", actions: [] });
    expect(timeline?.message).toContain("cancelled");
  });

  it("keeps the receipt route dashboard-only", async () => {
    const { created, pointer } = await createPreview();
    await approvePreview(created.response.worldPrId, pointer);
    const body = await executionTimelineRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.response.worldPrId}/execution`, {
      headers: { authorization: `Bearer ${process.env.MCP_BACKEND_TOKEN}` },
    }), { params: Promise.resolve({ worldPrId: created.response.worldPrId }) });
    expect(body.status).toBe(401);

    const session = createSessionValue("demo-operator");
    const dashboard = await executionTimelineRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.response.worldPrId}/execution`, {
      headers: { cookie: `rewind_session=${session}` },
    }), { params: Promise.resolve({ worldPrId: created.response.worldPrId }) });
    expect(dashboard.status).toBe(200);
    await expect(dashboard.json()).resolves.toMatchObject({ contractVersion: "execution-timeline.v1", overallStatus: "not_started" });
  });
});
