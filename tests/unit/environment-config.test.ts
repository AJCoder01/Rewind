import { describe, expect, it } from "vitest";
import {
  EnvironmentConfigError,
  parseApplicationEnvironment,
  parseMcpEnvironment,
  redactEnvironmentError,
} from "@/lib/config/environment";

const validEnvironment = {
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
  REWIND_RECIPIENT_ALLOWLIST: JSON.stringify({ UK: ["uk-team@example.com"], US: ["us-team@example.com"] }),
  REWIND_DEMO_DATE: "2026-08-20",
} as const;

function withEnvironment(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = { ...validEnvironment };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result;
}

function expectConfigError(callback: () => unknown, fields: string[]): void {
  try {
    callback();
    throw new Error("expected configuration validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentConfigError);
    const configError = error as EnvironmentConfigError;
    expect(configError.issues.map((entry) => entry.field)).toEqual(expect.arrayContaining(fields));
  }
}

describe("private environment contract", () => {
  it("validates and normalizes the complete application configuration", () => {
    const parsed = parseApplicationEnvironment({
      ...validEnvironment,
      APP_BASE_URL: "http://localhost:3000/",
      REWIND_RECIPIENT_ALLOWLIST: JSON.stringify({ UK: [" UK-Team@Example.com "], US: ["us-team@example.com"] }),
      REWIND_GOOGLE_EXPECTED_SUB: "google-subject",
      REWIND_GOOGLE_CALENDAR_ID: "calendar-id",
    });
    expect(parsed.APP_BASE_URL).toBe("http://localhost:3000");
    expect(parsed.REWIND_RECIPIENT_ALLOWLIST).toEqual({
      UK: ["uk-team@example.com"],
      US: ["us-team@example.com"],
    });
    expect(parsed.REWIND_GOOGLE_EXPECTED_SUB).toBe("google-subject");
  });

  it("does not read process.env until a loader is called", () => {
    expect(() => parseMcpEnvironment({
      APP_BASE_URL: "https://rewind.example.test",
      MCP_BACKEND_TOKEN: "mcp-token-01234567890123456789012345",
    })).not.toThrow();
  });

  it("rejects missing and weak authentication/provider secrets", () => {
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({ REWIND_SESSION_SECRET: "short" })), [
      "REWIND_SESSION_SECRET",
    ]);
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({ MCP_BACKEND_TOKEN: undefined })), [
      "MCP_BACKEND_TOKEN",
    ]);
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({
      REWIND_MODEL_RUNTIME: "openai_responses",
      REWIND_LOCAL_MODEL: undefined,
      OPENAI_API_KEY: "change-me",
      OPENAI_MODEL: "gpt-5.6-sol",
    })), [
      "OPENAI_API_KEY",
    ]);
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({
      REWIND_MODEL_RUNTIME: "openai_responses",
      REWIND_LOCAL_MODEL: undefined,
      OPENAI_MODEL: "gpt-5.6-sol",
    })), [
      "OPENAI_API_KEY",
    ]);
  });

  it("supports a zero-credit local runtime without OpenAI credentials", () => {
    const parsed = parseApplicationEnvironment(withEnvironment({
      OPENAI_API_KEY: undefined,
      OPENAI_MODEL: undefined,
    }));

    expect(parsed.REWIND_MODEL_RUNTIME).toBe("local_ollama");
    expect(parsed.REWIND_LOCAL_MODEL).toBe("qwen2.5-coder:latest");
    expect(parsed.OPENAI_API_KEY).toBeUndefined();
    expect(parsed.OPENAI_MODEL).toBeUndefined();
  });

  it("requires an explicit product runtime and keeps the S043 selector separate", () => {
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({
      REWIND_MODEL_RUNTIME: undefined,
      REWIND_S043_MODEL_RUNTIME: "local_ollama",
    })), ["REWIND_MODEL_RUNTIME"]);
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({
      OPENAI_API_KEY: undefined,
      OPENAI_MODEL: undefined,
      REWIND_MODEL_RUNTIME: "local_ollama",
      REWIND_LOCAL_MODEL: undefined,
    })), ["REWIND_LOCAL_MODEL"]);
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({
      REWIND_MODEL_RUNTIME: "local_ollama",
      REWIND_LOCAL_MODEL: "remote:cloud",
    })), ["REWIND_LOCAL_MODEL"]);
    expect(() => parseApplicationEnvironment(withEnvironment({
      REWIND_MODEL_RUNTIME: "local_ollama",
      REWIND_S043_MODEL_RUNTIME: "openai_responses",
      REWIND_LOCAL_MODEL: "qwen2.5-coder:latest",
    }))).not.toThrow();
  });

  it("supports OpenAI only when the product runtime and provider fields are explicit", () => {
    const parsed = parseApplicationEnvironment(withEnvironment({
      REWIND_MODEL_RUNTIME: "openai_responses",
      REWIND_LOCAL_MODEL: undefined,
      OPENAI_API_KEY: "sk-project-key-012345678901234",
      OPENAI_MODEL: "gpt-5.6-sol",
    }));
    expect(parsed.REWIND_MODEL_RUNTIME).toBe("openai_responses");
  });

  it("rejects production HTTP/local origins and fixture storage", () => {
    expectConfigError(
      () => parseApplicationEnvironment(withEnvironment({ NODE_ENV: "production", REWIND_STORAGE_MODE: "memory_fixture" })),
      ["APP_BASE_URL", "REWIND_STORAGE_MODE"],
    );
    expectConfigError(
      () => parseApplicationEnvironment(withEnvironment({ NODE_ENV: "production", APP_BASE_URL: "http://rewind.example.test" })),
      ["APP_BASE_URL"],
    );
  });

  it("requires a database for postgres mode and validates its TLS URL", () => {
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({ DATABASE_URL: undefined })), ["DATABASE_URL"]);
    expectConfigError(
      () => parseApplicationEnvironment(withEnvironment({ DATABASE_URL: "postgresql://rewind_app:secret@db.example.test:6543/rewind" })),
      ["DATABASE_URL"],
    );
  });

  it("requires the redirect to be the exact callback for the configured origin", () => {
    expectConfigError(
      () => parseApplicationEnvironment(withEnvironment({ GOOGLE_REDIRECT_URI: "https://rewind.example.test/wrong" })),
      ["GOOGLE_REDIRECT_URI"],
    );
  });

  it("rejects malformed allowlist JSON, extra keys, invalid email, and duplicate recipients", () => {
    for (const value of [
      "not-json",
      JSON.stringify({ UK: ["uk-team@example.com"], US: ["us-team@example.com"], extra: [] }),
      JSON.stringify({ UK: ["not-an-email"], US: ["us-team@example.com"] }),
      JSON.stringify({ UK: ["same@example.com"], US: ["same@example.com"] }),
    ]) {
      expectConfigError(() => parseApplicationEnvironment(withEnvironment({ REWIND_RECIPIENT_ALLOWLIST: value })), [
        "REWIND_RECIPIENT_ALLOWLIST",
      ]);
    }
  });

  it("rejects malformed demo dates and invalid Google identity fields", () => {
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({ REWIND_DEMO_DATE: "2026-02-30" })), [
      "REWIND_DEMO_DATE",
    ]);
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({ REWIND_DEMO_DATE: "2026-08-21" })), [
      "REWIND_DEMO_DATE",
    ]);
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({ REWIND_DEMO_DATE: "2026-08-21" })), [
      "REWIND_DEMO_DATE",
    ]);
    expectConfigError(
      () => parseApplicationEnvironment(withEnvironment({ REWIND_GOOGLE_EXPECTED_EMAIL: "not-an-email" })),
      ["REWIND_GOOGLE_EXPECTED_EMAIL"],
    );
  });

  it("requires a stable Google subject and validates the deferred calendar value", () => {
    expect(parseApplicationEnvironment(validEnvironment).REWIND_GOOGLE_EXPECTED_SUB).toBe("google-subject");
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({ REWIND_GOOGLE_EXPECTED_SUB: undefined })), [
      "REWIND_GOOGLE_EXPECTED_SUB",
    ]);
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({ REWIND_GOOGLE_EXPECTED_SUB: "has whitespace" })), [
      "REWIND_GOOGLE_EXPECTED_SUB",
    ]);
    expectConfigError(() => parseApplicationEnvironment(withEnvironment({ REWIND_GOOGLE_CALENDAR_ID: " calendar " })), [
      "REWIND_GOOGLE_CALENDAR_ID",
    ]);
  });

  it("returns safe errors without including literal secret or recipient values", () => {
    const secret = "session-secret-012345678901234567890123";
    let error: unknown;
    try {
      parseApplicationEnvironment(withEnvironment({ REWIND_SESSION_SECRET: "short", REWIND_RECIPIENT_ALLOWLIST: "not-json" }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EnvironmentConfigError);
    const safe = redactEnvironmentError(error);
    expect(safe).not.toContain(secret);
    expect(safe).not.toContain("not-json");
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain("not-json");
  });

  it("validates the separate MCP contract without requiring provider credentials", () => {
    expect(parseMcpEnvironment({
      NODE_ENV: "production",
      APP_BASE_URL: "https://rewind.example.test",
      MCP_BACKEND_TOKEN: "mcp-token-01234567890123456789012345",
    })).toEqual({
      NODE_ENV: "production",
      APP_BASE_URL: "https://rewind.example.test",
      MCP_BACKEND_TOKEN: "mcp-token-01234567890123456789012345",
    });
  });
});
