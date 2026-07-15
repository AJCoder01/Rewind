import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { cancelWorldPr, createWorldPr, getWorldPr } from "@/lib/services/world-pr";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";
import { getWorldPrStore } from "@/lib/db";
import { FakeProviderConfigurationError } from "@/lib/db/store";

const request = SUPPORTED_SCENARIO_REQUEST;

describe("S021 serialized fixture intake", () => {
  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.REWIND_STORAGE_MODE = "memory_fixture";
    memoryFixtureStore.clear();
  });

  afterEach(() => {
    memoryFixtureStore.clear();
    delete process.env.REWIND_STORAGE_MODE;
    delete process.env.APP_BASE_URL;
  });

  it("returns an analyzing replay while the first identical saga owns the claim", async () => {
    memoryFixtureStore.setPlanningDelay(40);
    const firstPromise = createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idem-concurrent-0001", request: { request } });
    const replay = await createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idem-concurrent-0001", request: { request } });
    const first = await firstPromise;
    expect(first.response.worldPrId).toBe(replay.response.worldPrId);
    expect(first.response.status).toBe("preview_ready");
    expect(replay.replay).toBe(true);
    expect(replay.response.status).toBe("analyzing");
    expect(replay.response.replayPending).toBe(true);
  });

  it("evaluates an active fixture rule before a scenario lock and persists clarification only", async () => {
    memoryFixtureStore.setFixtureRuleActive(true);
    const result = await createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idem-clarification-0001", request: { request } });
    expect(result.response.status).toBe("clarification_required");
    expect(result.view.status).toBe("clarification_required");
    expect(result.view.activePlan).toBeUndefined();
    expect(result.view.runId).toBeUndefined();
    expect(memoryFixtureStore.hasScenarioLock()).toBe(false);
  });

  it("allows clarification to coexist with an effect-bearing scenario lock", async () => {
    await createWorldPr({ actorId: "test:first", source: "dashboard", idempotencyKey: "idem-first-plan-0001", request: { request } });
    memoryFixtureStore.setFixtureRuleActive(true);
    const clarification = await createWorldPr({ actorId: "test:second", source: "dashboard", idempotencyKey: "idem-second-clarify-1", request: { request } });
    expect(clarification.response.status).toBe("clarification_required");
    expect(memoryFixtureStore.hasScenarioLock()).toBe(true);
  });

  it("returns scenario_busy for a second effect-bearing plan", async () => {
    await createWorldPr({ actorId: "test:first", source: "dashboard", idempotencyKey: "idem-first-plan-0002", request: { request } });
    await expect(createWorldPr({ actorId: "test:second", source: "dashboard", idempotencyKey: "idem-second-plan-0002", request: { request } })).rejects.toMatchObject({ code: "scenario_busy" });
  });

  it("replays a safe terminal planning failure without entering a second saga", async () => {
    memoryFixtureStore.failNextPlanning("internal_error");
    await expect(createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idem-failed-0001", request: { request } })).rejects.toMatchObject({ code: "internal_error" });
    await expect(createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idem-failed-0001", request: { request } })).rejects.toMatchObject({ code: "internal_error" });
    expect(memoryFixtureStore.hasScenarioLock()).toBe(false);
  });

  it("reclaims an expired planning lease only before any effect marker", async () => {
    const first = await createWorldPr({ actorId: "test:first", source: "dashboard", idempotencyKey: "idem-expired-first-1", request: { request } });
    memoryFixtureStore.expirePlanningLease();
    const second = await createWorldPr({ actorId: "test:second", source: "dashboard", idempotencyKey: "idem-expired-second-1", request: { request } });
    expect(second.response.status).toBe("preview_ready");
    expect((await getWorldPr(first.response.worldPrId, "test:first"))?.status).toBe("failed");
  });

  it("cancels a preview and releases only its scenario lock", async () => {
    const created = await createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idem-cancel-create-1", request: { request } });
    const cancelled = await cancelWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idem-cancel-action-1", worldPrId: created.response.worldPrId, request: {} });
    expect(cancelled.response.status).toBe("cancelled");
    expect(memoryFixtureStore.hasScenarioLock()).toBe(false);
    await expect(cancelWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idem-cancel-action-2", worldPrId: created.response.worldPrId, request: {} })).rejects.toMatchObject({ code: "invalid_task_state" });
  });

  it("enforces resource scope on reads", async () => {
    const created = await createWorldPr({ actorId: "test:owner", source: "dashboard", idempotencyKey: "idem-scope-create-1", request: { request } });
    await expect(getWorldPr(created.response.worldPrId, "test:other")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses the fixture provider boundary in production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    expect(() => getWorldPrStore()).toThrow(FakeProviderConfigurationError);
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  });
});
