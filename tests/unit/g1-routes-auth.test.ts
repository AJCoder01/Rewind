import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as createWorldPrRoute } from "@/app/api/v1/world-prs/route";
import { GET as readWorldPrRoute } from "@/app/api/v1/world-prs/[worldPrId]/route";
import { POST as cancelWorldPrRoute } from "@/app/api/v1/world-prs/[worldPrId]/cancel/route";
import { GET as statusWorldPrRoute } from "@/app/api/v1/world-prs/[worldPrId]/status/route";
import { createSessionValue } from "@/lib/auth/session";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  APP_BASE_URL: process.env.APP_BASE_URL,
  REWIND_STORAGE_MODE: process.env.REWIND_STORAGE_MODE,
  REWIND_SESSION_SECRET: process.env.REWIND_SESSION_SECRET,
  MCP_BACKEND_TOKEN: process.env.MCP_BACKEND_TOKEN,
  REWIND_DASHBOARD_PASSCODE: process.env.REWIND_DASHBOARD_PASSCODE,
};

function dashboardHeaders(session: string, csrf = "csrf-token-for-tests", idempotencyKey = "idem-route-create-0001"): Record<string, string> {
  return {
    origin: "http://localhost:3000",
    cookie: `rewind_session=${session}; rewind_csrf=${csrf}`,
    "x-rewind-csrf": csrf,
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
  };
}

describe("S022/S024 authenticated thin route boundaries", () => {
  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.REWIND_STORAGE_MODE = "memory_fixture";
    process.env.REWIND_SESSION_SECRET = "route-session-secret-that-is-long-enough-0001";
    process.env.MCP_BACKEND_TOKEN = "route-mcp-token-that-is-long-enough-0001";
    memoryFixtureStore.clear();
  });

  afterEach(() => {
    memoryFixtureStore.clear();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key as keyof typeof process.env];
      else process.env[key as keyof typeof process.env] = value;
    }
  });

  it("rejects unauthenticated create and CSRF-missing dashboard mutation", async () => {
    const unauthenticated = await createWorldPrRoute(new NextRequest("http://localhost:3000/api/v1/world-prs", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/json", "idempotency-key": "idem-route-unauth-0001" },
      body: JSON.stringify({ request: SUPPORTED_SCENARIO_REQUEST }),
    }));
    expect(unauthenticated.status).toBe(401);

    const session = createSessionValue("demo-operator");
    const missingCsrf = dashboardHeaders(session);
    delete missingCsrf["x-rewind-csrf"];
    const csrfResponse = await createWorldPrRoute(new NextRequest("http://localhost:3000/api/v1/world-prs", {
      method: "POST",
      headers: missingCsrf,
      body: JSON.stringify({ request: SUPPORTED_SCENARIO_REQUEST }),
    }));
    expect(csrfResponse.status).toBe(403);
    await expect(csrfResponse.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it("creates, reads, cancels, and scopes a World PR through thin routes", async () => {
    const session = createSessionValue("demo-operator");
    const createdResponse = await createWorldPrRoute(new NextRequest("http://localhost:3000/api/v1/world-prs", {
      method: "POST",
      headers: dashboardHeaders(session),
      body: JSON.stringify({ request: SUPPORTED_SCENARIO_REQUEST }),
    }));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { worldPrId: string };

    const readResponse = await readWorldPrRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.worldPrId}`, {
      headers: { cookie: `rewind_session=${session}; rewind_csrf=csrf-token-for-tests` },
    }), { params: Promise.resolve({ worldPrId: created.worldPrId }) });
    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({ worldPrId: created.worldPrId, status: "preview_ready" });

    const otherSession = createSessionValue("another-operator");
    const forbidden = await readWorldPrRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.worldPrId}`, {
      headers: { cookie: `rewind_session=${otherSession}; rewind_csrf=csrf-token-for-tests` },
    }), { params: Promise.resolve({ worldPrId: created.worldPrId }) });
    expect(forbidden.status).toBe(403);

    const cancelled = await cancelWorldPrRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.worldPrId}/cancel`, {
      method: "POST",
      headers: dashboardHeaders(session, "csrf-token-for-tests", "idem-route-cancel-0001"),
      body: "{}",
    }), { params: Promise.resolve({ worldPrId: created.worldPrId }) });
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({ worldPrId: created.worldPrId, status: "cancelled" });

    const malformedCancel = await cancelWorldPrRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.worldPrId}/cancel`, {
      method: "POST",
      headers: dashboardHeaders(session, "csrf-token-for-tests", "idem-route-cancel-malformed"),
      body: "{",
    }), { params: Promise.resolve({ worldPrId: created.worldPrId }) });
    expect(malformedCancel.status).toBe(422);
  });

  it("accepts only the scoped MCP bearer for create and keeps MCP read output safe", async () => {
    const response = await createWorldPrRoute(new NextRequest("http://localhost:3000/api/v1/world-prs", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.MCP_BACKEND_TOKEN}`,
        "content-type": "application/json",
        "idempotency-key": "idem-route-mcp-0000001",
      },
      body: JSON.stringify({ request: SUPPORTED_SCENARIO_REQUEST }),
    }));
    expect(response.status).toBe(201);
    const created = await response.json() as { worldPrId: string };
    const status = await readWorldPrRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.worldPrId}`, {
      headers: { authorization: `Bearer ${process.env.MCP_BACKEND_TOKEN}` },
    }), { params: Promise.resolve({ worldPrId: created.worldPrId }) });
    expect(status.status).toBe(200);
    const body = await status.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("activePlan");
    expect(body).not.toHaveProperty("timeline");
    const safeStatus = await statusWorldPrRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.worldPrId}/status`, {
      headers: { authorization: `Bearer ${process.env.MCP_BACKEND_TOKEN}` },
    }), { params: Promise.resolve({ worldPrId: created.worldPrId }) });
    expect(safeStatus.status).toBe(200);
    await expect(safeStatus.json()).resolves.toEqual(expect.objectContaining({ worldPrId: created.worldPrId, status: "preview_ready" }));

    const dashboardSession = createSessionValue("demo-operator");
    const dashboardReview = await readWorldPrRoute(new NextRequest(`http://localhost:3000/api/v1/world-prs/${created.worldPrId}`, {
      headers: { cookie: `rewind_session=${dashboardSession}; rewind_csrf=csrf-token-for-tests` },
    }), { params: Promise.resolve({ worldPrId: created.worldPrId }) });
    expect(dashboardReview.status).toBe(200);
    await expect(dashboardReview.json()).resolves.toMatchObject({ worldPrId: created.worldPrId, status: "preview_ready" });
  });

  it("rejects an expired dashboard session", async () => {
    const expired = createSessionValue("demo-operator", Math.floor(Date.now() / 1000) - 60 * 60 * 9);
    const response = await readWorldPrRoute(new NextRequest("http://localhost:3000/api/v1/world-prs/wpr_expired", {
      headers: { cookie: `rewind_session=${expired}; rewind_csrf=csrf-token-for-tests` },
    }), { params: Promise.resolve({ worldPrId: "wpr_expired" }) });
    expect(response.status).toBe(401);
  });

  it("maps a production fake-provider refusal to the documented retryable 503 response", async () => {
    const environment = process.env as Record<string, string | undefined>;
    environment.NODE_ENV = "production";
    process.env.APP_BASE_URL = "https://rewind.example.test";
    process.env.REWIND_STORAGE_MODE = "memory_fixture";
    process.env.REWIND_DASHBOARD_PASSCODE = "route-dashboard-passcode-0001";
    const session = createSessionValue("demo-operator");

    const response = await readWorldPrRoute(new NextRequest("https://rewind.example.test/api/v1/world-prs/wpr_provider_unavailable", {
      headers: { cookie: `rewind_session=${session}; rewind_csrf=csrf-token-for-tests` },
    }), { params: Promise.resolve({ worldPrId: "wpr_provider_unavailable" }) });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "provider_unavailable", retryable: true } });
  });
});
