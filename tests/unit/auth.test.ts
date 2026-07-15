import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createSessionValue, isSameOrigin, readDashboardActor, safeSecretEqual, sessionCookieName } from "@/lib/auth/session";
import { safeReturnPath } from "@/lib/auth/return-path";
import { POST as createDashboardSession } from "@/app/api/v1/auth/session/route";

const originalBaseUrl = process.env.APP_BASE_URL;
const originalSessionSecret = process.env.REWIND_SESSION_SECRET;
const originalDashboardPasscode = process.env.REWIND_DASHBOARD_PASSCODE;
const originalMcpBackendToken = process.env.MCP_BACKEND_TOKEN;
const originalNodeEnvironment = process.env.NODE_ENV;
const mutableEnvironment = process.env as Record<string, string | undefined>;

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalBaseUrl;
  if (originalSessionSecret === undefined) delete process.env.REWIND_SESSION_SECRET;
  else process.env.REWIND_SESSION_SECRET = originalSessionSecret;
  if (originalDashboardPasscode === undefined) delete process.env.REWIND_DASHBOARD_PASSCODE;
  else process.env.REWIND_DASHBOARD_PASSCODE = originalDashboardPasscode;
  if (originalMcpBackendToken === undefined) delete process.env.MCP_BACKEND_TOKEN;
  else process.env.MCP_BACKEND_TOKEN = originalMcpBackendToken;
  if (originalNodeEnvironment === undefined) delete mutableEnvironment.NODE_ENV;
  else mutableEnvironment.NODE_ENV = originalNodeEnvironment;
});

describe("dashboard and MCP request authentication helpers", () => {
  it("compares secrets without direct string equality", () => {
    expect(safeSecretEqual("scoped-secret", "scoped-secret")).toBe(true);
    expect(safeSecretEqual("wrong", "scoped-secret")).toBe(false);
  });

  it("uses the configured public app origin for same-origin checks", () => {
    process.env.APP_BASE_URL = "http://127.0.0.1:3100";
    const accepted = new NextRequest("http://localhost:3100/api/v1/auth/session", {
      headers: { origin: "http://127.0.0.1:3100" },
    });
    const rejected = new NextRequest("http://localhost:3100/api/v1/auth/session", {
      headers: { origin: "https://example.invalid" },
    });
    const refererFallback = new NextRequest("http://localhost:3100/api/v1/auth/session", {
      headers: { referer: "http://127.0.0.1:3100/login?next=%2F" },
    });
    const suppliedOriginTakesPrecedence = new NextRequest("http://localhost:3100/api/v1/auth/session", {
      headers: { origin: "https://example.invalid", referer: "http://127.0.0.1:3100/login" },
    });
    expect(isSameOrigin(accepted)).toBe(true);
    expect(isSameOrigin(rejected)).toBe(false);
    expect(isSameOrigin(refererFallback)).toBe(true);
    expect(isSameOrigin(suppliedOriginTakesPrecedence)).toBe(false);
  });

  it("fails closed when no session signing secret is configured", () => {
    delete process.env.REWIND_SESSION_SECRET;
    expect(() => createSessionValue("demo-operator")).toThrow("REWIND_SESSION_SECRET is required");
  });

  it("accepts only an unexpired, untampered, exactly three-part signed session", () => {
    process.env.REWIND_SESSION_SECRET = "unit-test-session-secret-that-is-not-used-live";
    const valid = createSessionValue("demo-operator");
    const requestWith = (value: string) =>
      new NextRequest("http://127.0.0.1:3100/api/v1/world-prs/example", {
        headers: { cookie: `${sessionCookieName()}=${value}` },
      });
    expect(readDashboardActor(requestWith(valid))).toEqual({ actorId: "demo-operator", source: "dashboard" });
    expect(readDashboardActor(requestWith(`${valid}x`))).toBeNull();
    expect(readDashboardActor(requestWith(`${valid}.extra`))).toBeNull();

    const expired = createSessionValue("demo-operator", Math.floor(Date.now() / 1000) - 60 * 60 * 9);
    expect(readDashboardActor(requestWith(expired))).toBeNull();
  });

  it("allows only same-site relative login return paths", () => {
    expect(safeReturnPath("/pr/wpr_123?tab=plan")).toBe("/pr/wpr_123?tab=plan");
    expect(safeReturnPath("https://example.invalid/steal")).toBe("/");
    expect(safeReturnPath("//example.invalid/steal")).toBe("/");
    expect(safeReturnPath("/\\example.invalid/steal")).toBe("/");
  });

  it("returns a safe 503 without setting a cookie when session signing is not configured", async () => {
    process.env.APP_BASE_URL = "http://127.0.0.1:3100";
    process.env.REWIND_DASHBOARD_PASSCODE = "correct-unit-test-passcode";
    delete process.env.REWIND_SESSION_SECRET;
    const response = await createDashboardSession(
      new NextRequest("http://127.0.0.1:3100/api/v1/auth/session", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3100", "content-type": "application/json" },
        body: JSON.stringify({ passcode: "correct-unit-test-passcode" }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ error: { code: "provider_unavailable", retryable: true } });
  });

  it("fails closed in production before issuing a session when the scoped MCP configuration is absent", async () => {
    mutableEnvironment.NODE_ENV = "production";
    process.env.APP_BASE_URL = "https://rewind.example.test";
    process.env.REWIND_SESSION_SECRET = "unit-test-session-secret-that-is-not-used-live";
    process.env.REWIND_DASHBOARD_PASSCODE = "correct-unit-test-passcode";
    delete process.env.MCP_BACKEND_TOKEN;
    const response = await createDashboardSession(
      new NextRequest("https://rewind.example.test/api/v1/auth/session", {
        method: "POST",
        headers: { origin: "https://rewind.example.test", "content-type": "application/json" },
        body: JSON.stringify({ passcode: "correct-unit-test-passcode" }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({ error: { code: "provider_unavailable", retryable: true } });
  });
});
