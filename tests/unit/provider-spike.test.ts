import { describe, expect, it } from "vitest";
import { FakeCalendarPort } from "@/lib/adapters/calendar";
import { sha256Text } from "@/lib/domain/digest";
import { MemoryDemoEventStateStore } from "@/lib/db/demo-event-state";
import { LocalModelSpikeReportSchema, ProviderSpikeReportSchema } from "@/lib/contracts/provider-spike";
import { seedControlledCalendar } from "@/lib/services/calendar-demo";
import {
  assertProviderSpikeExecutionDisabled,
  ProviderSpikeGuardError,
  ProviderSpikeFailureError,
  providerSpikeConfirmationPhrase,
  providerSpikeModelRuntime,
  runControlledCalendarProviderSpike,
  runControlledProviderModelSpikePhases,
  safeProviderSpikeFailureCode,
} from "@/lib/services/provider-spike";
import { OpenAIResponsesError } from "@/lib/ai/openai-responses";
import { ModelSafetyError } from "@/lib/ai/model-safety";
import { GoogleOAuthProviderError } from "@/lib/google/oauth";
import type { CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";

const configuration: CalendarDemoConfiguration = {
  calendarId: "demo-calendar-2026",
  demoDate: "2026-08-20",
  expectedEmail: "owner@example.com",
  recipients: { UK: ["uk-team@example.com"], US: ["us-team@example.com"] },
};

describe("controlled provider spike boundary", () => {
  it("proves a two-event preflight, stale conditional conflict, move, restore, and final preflight", async () => {
    const calendar = new FakeCalendarPort({ events: [], organizerDigest: sha256Text(configuration.expectedEmail) });
    const state = new MemoryDemoEventStateStore();
    await seedControlledCalendar({ calendar, state, configuration, runId: "seed-spike-001" });

    const result = await runControlledCalendarProviderSpike({
      calendar,
      state,
      configuration,
      runId: "run-spike-001",
    });

    expect(result.preflightBefore).toMatchObject({ candidateCount: 2, baselineCount: 2, expectedVersionCount: 2 });
    expect(result.staleConflict).toEqual({ status: "conflict", reason: "provider_conflict" });
    expect(result.move).toEqual({ status: "succeeded" });
    expect(result.restore).toEqual({ status: "succeeded" });
    expect(result.preflightAfter).toMatchObject({ candidateCount: 2, baselineCount: 2, expectedVersionCount: 2 });
    expect(result.partialReceiptStatuses).toEqual({ uk: ["succeeded", "succeeded"], us: ["conflict"] });
    expect(await calendar.getControlledEvent({ calendarId: configuration.calendarId, providerEventId: "fake-seeded-event-uk" })).toMatchObject({
      start: { instant: "2026-08-20T14:00:00.000Z" },
    });
    expect(await calendar.getControlledEvent({ calendarId: configuration.calendarId, providerEventId: "fake-seeded-event-us" })).toMatchObject({
      start: { instant: "2026-08-20T15:00:00.000Z" },
    });
  });

  it("requires the explicit live flag and rejects attempts to enable product effects", () => {
    const expectGuard = (environment: Readonly<Record<string, string | undefined>>, kind: string): void => {
      expect(() => assertProviderSpikeExecutionDisabled(environment)).toThrowError(ProviderSpikeGuardError);
      try {
        assertProviderSpikeExecutionDisabled(environment);
      } catch (error) {
        expect(error).toMatchObject({ kind });
      }
    };
    expectGuard({}, "live_flag_required");
    expectGuard({ LIVE_INTEGRATION_TESTS: "1", REWIND_PRODUCT_EXECUTION_ENABLED: "true" }, "execution_enabled");
    expectGuard({ LIVE_INTEGRATION_TESTS: "1", REWIND_PRODUCT_RESET_ENABLED: "1" }, "reset_enabled");
    expect(() => assertProviderSpikeExecutionDisabled({ LIVE_INTEGRATION_TESTS: "1" })).not.toThrow();
  });

  it("keeps the exact target only in the private confirmation phrase", () => {
    const runtime = providerSpikeModelRuntime({ REWIND_S043_MODEL_RUNTIME: "local_ollama", REWIND_LOCAL_MODEL: "gemma3:4b" }, "unused");
    expect(providerSpikeConfirmationPhrase("run-spike-001", "calendar-123", runtime)).toBe(
      "CONFIRM PROVIDER SPIKE run-spike-001 CALENDAR calendar-123 MODEL LOCAL_OLLAMA gemma3:4b",
    );
  });

  it("selects only explicit loopback Ollama or configured OpenAI model runtimes", () => {
    expect(providerSpikeModelRuntime({}, "gpt-test")).toEqual({
      runtime: "openai_responses",
      evidenceClass: "external_openai",
      provider: "openai",
      model: "gpt-test",
    });
    expect(providerSpikeModelRuntime({ REWIND_S043_MODEL_RUNTIME: "local_ollama" }, "unused")).toEqual({
      runtime: "local_ollama",
      evidenceClass: "local_model",
      provider: "ollama",
      model: "qwen2.5-coder:latest",
    });
    expect(() => providerSpikeModelRuntime({ REWIND_S043_MODEL_RUNTIME: "local_ollama", REWIND_LOCAL_MODEL: "remote:cloud" }, "unused")).toThrowError(
      ProviderSpikeFailureError,
    );
    expect(() => providerSpikeModelRuntime({ REWIND_S043_MODEL_RUNTIME: "unknown" }, "unused")).toThrowError(ProviderSpikeFailureError);
  });

  it("accepts only the redacted report shape and fixed operation schema versions", () => {
    const report = {
      status: "ok",
      operation: "provider_model_spikes",
      contractVersion: "provider-spike.v2",
      calendar: {
        preflightBefore: { status: "ok", contractVersion: "calendar-demo.v1", candidateCount: 2, baselineCount: 2, expectedVersionCount: 2 },
        staleConflict: { status: "conflict", reason: "provider_conflict" },
        move: { status: "succeeded" },
        restore: { status: "succeeded" },
        preflightAfter: { status: "ok", contractVersion: "calendar-demo.v1", candidateCount: 2, baselineCount: 2, expectedVersionCount: 2 },
        partialReceiptStatuses: { uk: ["succeeded", "succeeded"], us: ["conflict"] },
      },
      model: {
        runtime: "local_ollama",
        evidenceClass: "local_model",
        operations: [
          { operation: "initial", status: "validated", provider: "ollama", schemaVersion: "initial-reasoning.v1", attempts: 1, model: "test-model", receiptFingerprint: "sha256:0000000000000000" },
          { operation: "recovery", status: "validated", provider: "ollama", schemaVersion: "recovery-proposal.v1", attempts: 1, model: "test-model", receiptFingerprint: "sha256:1111111111111111" },
          { operation: "prevention_rule", status: "validated", provider: "ollama", schemaVersion: "prevention-rule-proposal.v1", attempts: 1, model: "test-model", receiptFingerprint: "sha256:2222222222222222" },
        ],
      },
      productExecution: "disabled",
      productReset: "disabled",
      externalEffects: "calendar_move_restore_only",
    } as const;
    expect(ProviderSpikeReportSchema.parse(report)).toEqual(report);
    expect(LocalModelSpikeReportSchema.safeParse({
      status: "ok",
      operation: "local_model_spike",
      contractVersion: "local-model-spike.v1",
      model: report.model,
      externalEffects: false,
    }).success).toBe(true);
    expect(ProviderSpikeReportSchema.safeParse({
      ...report,
      model: {
        runtime: "openai_responses",
        evidenceClass: "external_openai",
        operations: report.model.operations.map((operation) => ({ ...operation, provider: "openai" })),
      },
    }).success).toBe(true);
    expect(ProviderSpikeReportSchema.safeParse({ ...report, model: { operations: report.model.operations.map((item, index) => index === 0 ? { ...item, schemaVersion: "recovery-proposal.v1" } : item) } }).success).toBe(false);
    expect(ProviderSpikeReportSchema.safeParse({ ...report, model: { ...report.model, evidenceClass: "external_openai" } }).success).toBe(false);
    expect(ProviderSpikeReportSchema.safeParse({ ...report, rawProviderResponse: "forbidden" }).success).toBe(false);
  });

  it("maps known provider/model failures to safe diagnostic codes", () => {
    expect(safeProviderSpikeFailureCode(new ProviderSpikeFailureError("credential_unavailable"))).toBe("credential_unavailable");
    expect(safeProviderSpikeFailureCode(new GoogleOAuthProviderError("response_invalid"))).toBe("oauth_response_invalid");
    expect(safeProviderSpikeFailureCode(new OpenAIResponsesError("invalid_output", 2))).toBe("openai_invalid_output");
    expect(safeProviderSpikeFailureCode(new ModelSafetyError("recovery", "semantic_invalid", 2))).toBe("model_recovery_semantic_invalid");
    expect(safeProviderSpikeFailureCode(new ModelSafetyError("initial", "forbidden", 1))).toBe("model_initial_forbidden");
    expect(safeProviderSpikeFailureCode(new ModelSafetyError("initial", "timeout", 2))).toBe("model_initial_timeout");
  });

  it("completes the non-effecting model phase before Calendar and skips Calendar on model failure", async () => {
    const calls: string[] = [];
    await expect(
      runControlledProviderModelSpikePhases({
        runModel: async () => {
          calls.push("model");
          throw new ModelSafetyError("initial", "forbidden", 1);
        },
        runCalendar: async () => {
          calls.push("calendar");
          return "calendar-result";
        },
      }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect(calls).toEqual(["model"]);

    calls.length = 0;
    await expect(
      runControlledProviderModelSpikePhases({
        runModel: async () => {
          calls.push("model");
          return "model-result";
        },
        runCalendar: async () => {
          calls.push("calendar");
          return "calendar-result";
        },
      }),
    ).resolves.toEqual({ model: "model-result", calendar: "calendar-result" });
    expect(calls).toEqual(["model", "calendar"]);
  });
});
