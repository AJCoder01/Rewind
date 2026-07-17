import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ConnectionPreflightResponseSchema } from "@/lib/contracts/connection-preflight";
import { createSessionValue } from "@/lib/auth/session";
import { GET as connectionStatusRoute } from "@/app/api/v1/connection/status/route";
import { readConnectionPreflightStatus } from "@/lib/services/connection-preflight";
import { memoryOAuthStore } from "@/lib/db";

const baseEnvironment = {
  NODE_ENV: "test",
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://rewind_app:database-secret@localhost:5432/rewind",
  REWIND_STORAGE_MODE: "postgres",
  REWIND_SESSION_SECRET: "session-secret-012345678901234567890123",
  REWIND_DASHBOARD_PASSCODE: "dashboard-passcode-1234",
  MCP_BACKEND_TOKEN: "mcp-token-01234567890123456789012345",
  REWIND_MODEL_RUNTIME: "local_ollama",
  REWIND_LOCAL_MODEL: "qwen2.5-coder:latest",
  GOOGLE_CLIENT_ID: "1234567890-rewind.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-rewind-client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/api/v1/oauth/google/callback",
  REWIND_TOKEN_ENCRYPTION_KEY: "encryption-key-012345678901234567890123",
  REWIND_GOOGLE_EXPECTED_EMAIL: "rewind-demo@example.com",
  REWIND_GOOGLE_EXPECTED_SUB: "google-subject",
  REWIND_GOOGLE_CALENDAR_ID: "calendar-id",
  REWIND_RECIPIENT_ALLOWLIST: JSON.stringify({ UK: ["uk-team@example.com"], US: ["us-team@example.com"] }),
  REWIND_DEMO_DATE: "2026-08-20",
} as const;

const environmentKeys = [
  "NODE_ENV",
  "APP_BASE_URL",
  "DATABASE_URL",
  "REWIND_STORAGE_MODE",
  "REWIND_SESSION_SECRET",
  "REWIND_DASHBOARD_PASSCODE",
  "MCP_BACKEND_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "REWIND_TOKEN_ENCRYPTION_KEY",
  "REWIND_GOOGLE_EXPECTED_EMAIL",
  "REWIND_GOOGLE_EXPECTED_SUB",
  "REWIND_GOOGLE_CALENDAR_ID",
  "REWIND_RECIPIENT_ALLOWLIST",
  "REWIND_DEMO_DATE",
  "REWIND_MODEL_RUNTIME",
  "REWIND_S043_MODEL_RUNTIME",
  "REWIND_LOCAL_MODEL",
] as const;

const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  memoryOAuthStore.clear();
  const environment = process.env as Record<string, string | undefined>;
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
});

describe("S044 connection and preflight status", () => {
  it("labels fixture mode and never presents it as a passed provider preflight", async () => {
    const snapshot = await readConnectionPreflightStatus({
      environment: { ...baseEnvironment, REWIND_STORAGE_MODE: "memory_fixture" },
      readCredential: async () => null,
    });

    expect(snapshot.runtime).toMatchObject({ mode: "fixture", productExecution: "disabled", productReset: "disabled" });
    expect(snapshot.database).toEqual({ status: "fixture" });
    expect(snapshot.identity).toEqual({ status: "not_connected" });
    expect(snapshot.preflight.status).toBe("blocked");
    expect(snapshot.preflight.checks.map((check) => check.status)).toEqual(["passed", "not_run", "failed", "not_run"]);
    expect(JSON.stringify(snapshot)).not.toContain(baseEnvironment.DATABASE_URL);
  });

  it("shows the explicit product runtime and ignores the separate S043 selector", async () => {
    const snapshot = await readConnectionPreflightStatus({
      environment: { ...baseEnvironment, REWIND_S043_MODEL_RUNTIME: "openai_responses" },
      checkDatabase: async () => ({ ready: true, migrationId: "0002_oauth_transaction" }),
      readCredential: async () => ({
        provider: "google",
        googleSub: baseEnvironment.REWIND_GOOGLE_EXPECTED_SUB,
        email: baseEnvironment.REWIND_GOOGLE_EXPECTED_EMAIL,
        refreshTokenCiphertext: "ciphertext-never-returned",
        scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.events.owned", "https://www.googleapis.com/auth/gmail.send"],
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
        updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      }),
    });

    expect(snapshot.runtime).toMatchObject({ mode: "live_capable", modelRuntime: "local_ollama", productExecution: "enabled" });
    expect(snapshot.identity).toEqual({ status: "connected", email: baseEnvironment.REWIND_GOOGLE_EXPECTED_EMAIL });
    expect(snapshot.database).toEqual({ status: "ready", schemaVersion: "0002_oauth_transaction" });
    expect(snapshot.calendar).toEqual({ status: "configured" });
    expect(snapshot.demoDate).toEqual({ status: "configured" });
    expect(snapshot.preflight).toMatchObject({
      status: "not_run",
      checks: [
        { id: "configuration", status: "passed" },
        { id: "database", status: "passed" },
        { id: "google_identity", status: "passed" },
        { id: "calendar", status: "not_run" },
      ],
    });
    expect(snapshot.overall).toBe("attention");
    expect(snapshot.workflow.status).toBe("ready");
  });

  it("returns safe configuration gaps and blocks before dependency checks", async () => {
    let databaseChecked = false;
    const snapshot = await readConnectionPreflightStatus({
      environment: { ...baseEnvironment, REWIND_STORAGE_MODE: "memory_fixture", REWIND_SESSION_SECRET: undefined },
      checkDatabase: async () => {
        databaseChecked = true;
        return { ready: true, migrationId: "unexpected" };
      },
      readCredential: async () => null,
    });

    expect(databaseChecked).toBe(false);
    expect(snapshot.configuration.status).toBe("incomplete");
    expect(snapshot.configuration.issues).toContainEqual({ field: "REWIND_SESSION_SECRET", code: "invalid_type" });
    expect(snapshot.preflight.status).toBe("blocked");
    expect(JSON.stringify(snapshot)).not.toContain("sk-project-key");
  });

  it("enables the PostgreSQL workflow with local Ollama and no OpenAI credentials", async () => {
    const snapshot = await readConnectionPreflightStatus({
      environment: {
        ...baseEnvironment,
        OPENAI_API_KEY: undefined,
        OPENAI_MODEL: undefined,
        REWIND_MODEL_RUNTIME: "local_ollama",
        REWIND_LOCAL_MODEL: "qwen2.5-coder:latest",
      },
      checkDatabase: async () => ({ ready: true, migrationId: "0002_oauth_transaction" }),
      readCredential: async () => ({
        provider: "google",
        googleSub: baseEnvironment.REWIND_GOOGLE_EXPECTED_SUB,
        email: baseEnvironment.REWIND_GOOGLE_EXPECTED_EMAIL,
        refreshTokenCiphertext: "ciphertext-never-returned",
        scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.events.owned", "https://www.googleapis.com/auth/gmail.send"],
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
        updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      }),
    });

    expect(snapshot.runtime).toMatchObject({
      mode: "live_capable",
      modelRuntime: "local_ollama",
      productExecution: "enabled",
    });
    expect(snapshot.workflow.status).toBe("ready");
    expect(JSON.stringify(snapshot)).not.toContain("OPENAI_API_KEY");
  });

  it("does not infer a product runtime from OpenAI fields or the S043 selector", async () => {
    const snapshot = await readConnectionPreflightStatus({
      environment: {
        ...baseEnvironment,
        REWIND_MODEL_RUNTIME: undefined,
        REWIND_S043_MODEL_RUNTIME: "openai_responses",
        OPENAI_API_KEY: "sk-project-key-012345678901234",
        OPENAI_MODEL: "gpt-5.6-sol",
      },
      checkDatabase: async () => ({ ready: true, migrationId: "0002_oauth_transaction" }),
      readCredential: async () => null,
    });

    expect(snapshot.configuration).toMatchObject({ status: "incomplete" });
    expect(snapshot.configuration.issues).toContainEqual({ field: "REWIND_MODEL_RUNTIME", code: "required_for_postgres" });
    expect(snapshot.runtime).toMatchObject({ modelRuntime: "not_configured", productExecution: "disabled" });
  });

  it("reports OpenAI only when it is explicitly selected for the product", async () => {
    const snapshot = await readConnectionPreflightStatus({
      environment: {
        ...baseEnvironment,
        REWIND_MODEL_RUNTIME: "openai_responses",
        REWIND_LOCAL_MODEL: undefined,
        OPENAI_API_KEY: "sk-project-key-012345678901234",
        OPENAI_MODEL: "gpt-5.6-sol",
      },
      checkDatabase: async () => ({ ready: true, migrationId: "0002_oauth_transaction" }),
      readCredential: async () => ({
        provider: "google",
        googleSub: baseEnvironment.REWIND_GOOGLE_EXPECTED_SUB,
        email: baseEnvironment.REWIND_GOOGLE_EXPECTED_EMAIL,
        refreshTokenCiphertext: "ciphertext-never-returned",
        scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.events.owned", "https://www.googleapis.com/auth/gmail.send"],
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
        updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      }),
    });

    expect(snapshot.runtime).toMatchObject({ modelRuntime: "openai_responses", productExecution: "enabled" });
  });

  it("fails closed on a stored account substitution without returning its email", async () => {
    const snapshot = await readConnectionPreflightStatus({
      environment: baseEnvironment,
      checkDatabase: async () => ({ ready: true, migrationId: "0002_oauth_transaction" }),
      readCredential: async () => ({
        provider: "google",
        googleSub: "different-google-subject",
        email: "different@example.test",
        refreshTokenCiphertext: "ciphertext-never-returned",
        scopes: [],
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
        updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      }),
    });

    expect(snapshot.identity).toEqual({ status: "mismatch" });
    expect(snapshot.preflight.checks[2]).toMatchObject({ id: "google_identity", status: "failed" });
    expect(JSON.stringify(snapshot)).not.toContain("different@example.test");
  });

  it("requires the dashboard session and returns a strict, no-store response", async () => {
    Object.assign(process.env, baseEnvironment, { REWIND_STORAGE_MODE: "memory_fixture" });
    const unauthenticated = await connectionStatusRoute(new NextRequest("http://localhost:3000/api/v1/connection/status"));
    expect(unauthenticated.status).toBe(401);

    const session = createSessionValue("demo-operator");
    const authenticated = await connectionStatusRoute(new NextRequest("http://localhost:3000/api/v1/connection/status", {
      headers: { cookie: `rewind_session=${session}; rewind_csrf=csrf-for-test` },
    }));
    expect(authenticated.status).toBe(200);
    expect(authenticated.headers.get("cache-control")).toBe("no-store");
    const body = ConnectionPreflightResponseSchema.parse(await authenticated.json());
    expect(body.runtime.mode).toBe("fixture");
    expect(JSON.stringify(body)).not.toContain("ciphertext");
  });

  it("does not call a credential connected when approved scopes drift", async () => {
    const snapshot = await readConnectionPreflightStatus({
      environment: baseEnvironment,
      checkDatabase: async () => ({ ready: true, migrationId: "0002_oauth_transaction" }),
      readCredential: async () => ({
        provider: "google",
        googleSub: baseEnvironment.REWIND_GOOGLE_EXPECTED_SUB,
        email: baseEnvironment.REWIND_GOOGLE_EXPECTED_EMAIL,
        refreshTokenCiphertext: "ciphertext-never-returned",
        scopes: ["openid", "email"],
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
        updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      }),
    });

    expect(snapshot.identity).toEqual({ status: "mismatch" });
    expect(snapshot.preflight.checks[2].status).toBe("failed");
  });
});
