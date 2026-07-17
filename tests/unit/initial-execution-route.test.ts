import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as executeRoute } from "@/app/api/v1/world-prs/[worldPrId]/execution/route";
import { createSessionValue } from "@/lib/auth/session";
import { memoryExecutionStore } from "@/lib/db";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";
import { approveInitialPlan } from "@/lib/services/initial-approval";
import { createWorldPr } from "@/lib/services/world-pr";

const original = {
  NODE_ENV: process.env.NODE_ENV,
  APP_BASE_URL: process.env.APP_BASE_URL,
  REWIND_STORAGE_MODE: process.env.REWIND_STORAGE_MODE,
  REWIND_SESSION_SECRET: process.env.REWIND_SESSION_SECRET,
  MCP_BACKEND_TOKEN: process.env.MCP_BACKEND_TOKEN,
};

describe("initial execution HTTP boundary", () => {
  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.REWIND_STORAGE_MODE = "memory_fixture";
    process.env.REWIND_SESSION_SECRET = "execution-route-session-secret-that-is-long-enough";
    process.env.MCP_BACKEND_TOKEN = "execution-route-mcp-token-that-is-long-enough";
    memoryFixtureStore.clear();
    memoryExecutionStore.clear();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key as keyof typeof process.env];
      else process.env[key as keyof typeof process.env] = value;
    }
  });

  async function approvedFixture() {
    const created = await createWorldPr({
      actorId: "demo-operator",
      source: "dashboard",
      idempotencyKey: "execution-route-create-0001",
      request: { request: SUPPORTED_SCENARIO_REQUEST },
    });
    if (!created.view.activePlan || created.view.activePlan.pointer.kind !== "initial") throw new Error("Expected initial plan.");
    const pointer = created.view.activePlan.pointer;
    await approveInitialPlan({
      actorId: "demo-operator",
      source: "dashboard",
      idempotencyKey: "execution-route-approval-0001",
      worldPrId: created.view.worldPrId,
      request: { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest },
    });
    return { worldPrId: created.view.worldPrId, pointer };
  }

  function request(worldPrId: string, body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest(`http://localhost:3000/api/v1/world-prs/${worldPrId}/execution`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("rejects unauthenticated, MCP, missing-CSRF, mismatched-CSRF, and cross-origin mutations", async () => {
    const { worldPrId, pointer } = await approvedFixture();
    const body = { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest };
    const context = { params: Promise.resolve({ worldPrId }) };
    expect((await executeRoute(request(worldPrId, body, { "idempotency-key": "execution-route-unauth-0001" }), context)).status).toBe(401);
    expect((await executeRoute(request(worldPrId, body, { authorization: `Bearer ${process.env.MCP_BACKEND_TOKEN}`, "idempotency-key": "execution-route-mcp-0001" }), context)).status).toBe(401);

    const session = createSessionValue("demo-operator");
    expect((await executeRoute(request(worldPrId, body, {
      origin: "http://localhost:3000",
      cookie: `rewind_session=${session}; rewind_csrf=csrf-one`,
      "idempotency-key": "execution-route-no-csrf-0001",
    }), context)).status).toBe(403);
    expect((await executeRoute(request(worldPrId, body, {
      origin: "http://localhost:3000",
      cookie: `rewind_session=${session}; rewind_csrf=csrf-one`,
      "x-rewind-csrf": "csrf-two",
      "idempotency-key": "execution-route-bad-csrf-0001",
    }), context)).status).toBe(403);
    expect((await executeRoute(request(worldPrId, body, {
      origin: "https://attacker.example",
      cookie: `rewind_session=${session}; rewind_csrf=csrf-one`,
      "x-rewind-csrf": "csrf-one",
      "idempotency-key": "execution-route-cross-origin-0001",
    }), context)).status).toBe(403);
  });

  it("requires idempotency and refuses fixture substitution on an otherwise valid request", async () => {
    const { worldPrId, pointer } = await approvedFixture();
    const body = { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest };
    const session = createSessionValue("demo-operator");
    const safeHeaders = {
      origin: "http://localhost:3000",
      cookie: `rewind_session=${session}; rewind_csrf=csrf-one`,
      "x-rewind-csrf": "csrf-one",
    };
    const missingKey = await executeRoute(request(worldPrId, body, safeHeaders), { params: Promise.resolve({ worldPrId }) });
    expect(missingKey.status).toBe(422);
    const blocked = await executeRoute(request(worldPrId, body, { ...safeHeaders, "idempotency-key": "execution-route-valid-0001" }), { params: Promise.resolve({ worldPrId }) });
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("cache-control")).toBe("no-store");
    await expect(blocked.json()).resolves.toMatchObject({ error: { code: "provider_unavailable" } });
    expect((await memoryExecutionStore.listActions(pointer.planId)).every((action) => action.status === "planned")).toBe(true);
  });
});
