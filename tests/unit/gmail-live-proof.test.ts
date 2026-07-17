import { describe, expect, it } from "vitest";
import type { ApplicationEnvironment } from "@/lib/config/environment";
import { GMAIL_LIVE_PROOF_CONTRACT_VERSION } from "@/lib/contracts/gmail-live-proof";
import {
  GmailLiveProofGuardError,
  assertGmailLiveProofRecordMatches,
  assertGmailLiveProofSucceeded,
  assertTtyGatedGmailLiveProofEnvironment,
  buildGmailLiveProofPlan,
  completedGmailLiveProofReadModel,
  gmailLiveProofConfigurationFromEnvironment,
  gmailLiveProofConfirmationPhrase,
  gmailLiveProofTargetFingerprint,
  initialGmailLiveProofReadModel,
  safeGmailLiveProofFailureCode,
} from "@/lib/services/gmail-live-proof";

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

describe("S038 Gmail live-proof boundary", () => {
  it("requires the explicit live flag in addition to TTY, non-production, and PostgreSQL", () => {
    expect(() => assertTtyGatedGmailLiveProofEnvironment(
      { NODE_ENV: "development", REWIND_STORAGE_MODE: "postgres", LIVE_INTEGRATION_TESTS: "1" },
      { stdinIsTTY: true, stdoutIsTTY: true },
    )).not.toThrow();
    expect(() => assertTtyGatedGmailLiveProofEnvironment(
      { NODE_ENV: "development", REWIND_STORAGE_MODE: "postgres" },
      { stdinIsTTY: true, stdoutIsTTY: true },
    )).toThrowError(new GmailLiveProofGuardError("live_flag_required"));
    expect(() => assertTtyGatedGmailLiveProofEnvironment(
      { NODE_ENV: "production", REWIND_STORAGE_MODE: "postgres", LIVE_INTEGRATION_TESTS: "1" },
      { stdinIsTTY: true, stdoutIsTTY: true },
    )).toThrow();
  });

  it("builds one exact allowlisted, run-identified, digest-bound message", () => {
    const configuration = gmailLiveProofConfigurationFromEnvironment(environment);
    const plan = buildGmailLiveProofPlan(configuration, "run_s038_unit_001");
    expect(plan.schemaVersion).toBe(GMAIL_LIVE_PROOF_CONTRACT_VERSION);
    expect(plan.message).toMatchObject({
      senderGoogleSub: "google-subject",
      to: ["uk-team@example.com"],
      subject: "[Rewind run_s038_unit_001] Acme UK renewal moved",
      bodyText: "The Acme UK renewal is now scheduled for 2026-08-20 at 15:00 ET.",
    });
    expect(plan.message.bodyHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.replayKey).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects sending to the connected organizer and binds confirmation to the literal target", () => {
    expect(() => gmailLiveProofConfigurationFromEnvironment({
      ...environment,
      REWIND_RECIPIENT_ALLOWLIST: { UK: ["owner@example.com"], US: ["us-team@example.com"] },
    })).toThrowError(new GmailLiveProofGuardError("recipient_not_allowed"));
    expect(gmailLiveProofConfirmationPhrase("run_s038_unit_001", "uk-team@example.com")).toBe(
      "CONFIRM GMAIL SEND run_s038_unit_001 TO uk-team@example.com",
    );
    expect(() => gmailLiveProofConfirmationPhrase("run_s038_unit_001", "bad\nother@example.com")).toThrow();
  });

  it("keeps target output fingerprinted and excludes recipient/database literals", () => {
    const fingerprint = gmailLiveProofTargetFingerprint(
      "uk-team@example.com",
      "postgresql://rewind_app:private@db.example.test:5432/rewind?sslmode=require&uselibpqcompat=true",
    );
    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(fingerprint).not.toContain("uk-team");
    expect(fingerprint).not.toContain("db.example");
  });

  it("records completion only when replay returns the same receipt with one persisted attempt", () => {
    const plan = buildGmailLiveProofPlan(gmailLiveProofConfigurationFromEnvironment(environment), "run_s038_unit_001");
    const first = { status: "sent" as const, receipt: { status: "sent" as const, messageId: "gmail-message-1" }, replay: false, dispatchStartedAt: "2026-07-16T10:00:00.000Z" };
    const replay = { status: "sent" as const, receipt: { status: "sent" as const, messageId: "gmail-message-1" }, replay: true, dispatchStartedAt: "2026-07-16T10:00:00.000Z" };
    const completed = completedGmailLiveProofReadModel(plan, first, replay, new Date("2026-07-16T10:01:00.000Z"));
    expect(completed).toMatchObject({ status: "completed", firstStatus: "sent", replayStatus: "sent", replayVerified: true });
    expect(() => assertGmailLiveProofSucceeded(first, replay, 1)).not.toThrow();
    expect(() => assertGmailLiveProofSucceeded(first, replay, 2)).toThrowError(new GmailLiveProofGuardError("replay_not_verified"));
  });

  it("fails closed for drifted or uncertain existing proof state and emits safe codes", () => {
    const configuration = gmailLiveProofConfigurationFromEnvironment(environment);
    const plan = buildGmailLiveProofPlan(configuration, "run_s038_unit_001");
    const readModel = initialGmailLiveProofReadModel(plan, new Date("2026-07-16T10:00:00.000Z"));
    expect(() => assertGmailLiveProofRecordMatches({ plan, actionStatus: "planned", attempts: 0, dispatchStartedAt: null, receipt: null, readModel }, configuration)).not.toThrow();
    expect(() => assertGmailLiveProofRecordMatches({
      plan,
      actionStatus: "delivery_uncertain",
      attempts: 1,
      dispatchStartedAt: "2026-07-16T10:00:00.000Z",
      receipt: { status: "delivery_uncertain", reason: "transport_timeout" },
      readModel,
    }, configuration)).toThrowError(new GmailLiveProofGuardError("proof_not_retryable"));
    const completed = completedGmailLiveProofReadModel(
      plan,
      { status: "sent", receipt: { status: "sent", messageId: "gmail-message-1" }, replay: false, dispatchStartedAt: "2026-07-16T10:00:00.000Z" },
      { status: "sent", receipt: { status: "sent", messageId: "gmail-message-1" }, replay: true, dispatchStartedAt: "2026-07-16T10:00:00.000Z" },
      new Date("2026-07-16T10:01:00.000Z"),
    );
    expect(() => assertGmailLiveProofRecordMatches({
      plan,
      actionStatus: "in_progress",
      attempts: 1,
      dispatchStartedAt: "2026-07-16T10:00:00.000Z",
      receipt: null,
      readModel: completed,
    }, configuration)).toThrowError(new GmailLiveProofGuardError("existing_proof_conflict"));
    expect(safeGmailLiveProofFailureCode(new Error("private provider detail"))).toBe("failed_safely");
  });
});
