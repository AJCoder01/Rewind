import { describe, expect, it } from "vitest";
import type { ApplicationEnvironment } from "@/lib/config/environment";
import {
  DemoCommandGuardError,
  assertTtyGatedDemoEnvironment,
  calendarDemoConfigurationFromEnvironment,
  confirmationPhrase,
  safeDemoCommandFailureCode,
  targetFingerprint,
} from "@/lib/services/calendar-demo-command";

const environment: ApplicationEnvironment = {
  NODE_ENV: "development",
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://rewind_app:fake@localhost:5432/rewind",
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
  REWIND_GOOGLE_EXPECTED_EMAIL: "owner@example.com",
  REWIND_GOOGLE_EXPECTED_SUB: "google-subject",
  REWIND_GOOGLE_CALENDAR_ID: "demo-calendar-2026",
  REWIND_RECIPIENT_ALLOWLIST: { UK: ["uk-team@example.com"], US: ["us-team@example.com"] },
  REWIND_DEMO_DATE: "2026-08-20",
};

describe("TTY-gated Calendar command boundary", () => {
  it("allows only a non-production PostgreSQL command with two TTY streams", () => {
    expect(() => assertTtyGatedDemoEnvironment(
      { NODE_ENV: "development", REWIND_STORAGE_MODE: "postgres" },
      { stdinIsTTY: true, stdoutIsTTY: true },
    )).not.toThrow();
    expect(calendarDemoConfigurationFromEnvironment(environment)).toEqual({
      calendarId: "demo-calendar-2026",
      demoDate: "2026-08-20",
      expectedEmail: "owner@example.com",
      recipients: { UK: ["uk-team@example.com"], US: ["us-team@example.com"] },
    });
  });

  it.each([
    [{ NODE_ENV: "production", REWIND_STORAGE_MODE: "postgres" }, { stdinIsTTY: true, stdoutIsTTY: true }, "production_refused"],
    [{ NODE_ENV: "development", REWIND_STORAGE_MODE: "postgres", CI: "true" }, { stdinIsTTY: true, stdoutIsTTY: true }, "ci_refused"],
    [{ NODE_ENV: "development", REWIND_STORAGE_MODE: "postgres", CI: " true " }, { stdinIsTTY: true, stdoutIsTTY: true }, "ci_refused"],
    [{ NODE_ENV: "development", REWIND_STORAGE_MODE: "memory_fixture" }, { stdinIsTTY: true, stdoutIsTTY: true }, "fixture_storage_refused"],
    [{ NODE_ENV: "development", REWIND_STORAGE_MODE: "postgres" }, { stdinIsTTY: false, stdoutIsTTY: true }, "tty_required"],
  ] as const)("refuses %s", (rawEnvironment, io, kind) => {
    expect(() => assertTtyGatedDemoEnvironment(rawEnvironment, io)).toThrowError(new DemoCommandGuardError(kind));
  });

  it("refuses the implicit primary calendar and keeps target fingerprints sanitized", () => {
    expect(() => calendarDemoConfigurationFromEnvironment({ ...environment, REWIND_GOOGLE_CALENDAR_ID: "primary" })).toThrowError(
      new DemoCommandGuardError("calendar_target_missing"),
    );
    const fingerprint = targetFingerprint("demo-calendar-2026", "postgresql://rewind_app:private@db.example.test:5432/rewind?sslmode=require&uselibpqcompat=true");
    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(fingerprint).not.toContain("db.example");
  });

  it("binds the private TTY confirmation to the exact Calendar target and run ID", () => {
    expect(confirmationPhrase("seed", "seed_123", "demo-calendar-2026")).toBe(
      "CONFIRM SEED seed_123 CALENDAR demo-calendar-2026",
    );
    expect(() => confirmationPhrase("preflight", "preflight_123", "calendar\nother")).toThrowError(
      new DemoCommandGuardError("calendar_target_missing"),
    );
  });

  it("maps failures to safe codes without exposing error text", () => {
    const error = new DemoCommandGuardError("ci_refused");
    expect(safeDemoCommandFailureCode(error)).toBe("ci_refused");
    expect(safeDemoCommandFailureCode(new Error("private credential value"))).toBe("failed_safely");
  });
});
