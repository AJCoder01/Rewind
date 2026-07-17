import { describe, expect, it } from "vitest";
import { createProductModel, productModelSelection } from "@/lib/ai/product-model";
import { ProviderSpikeFailureError } from "@/lib/services/provider-spike";
import { productLocalProofRuntime } from "@/scripts/prove-local-model";
import { parseApplicationEnvironment } from "@/lib/config/environment";
import {
  MODEL_SAFETY_INITIAL_INPUT,
  MODEL_SAFETY_INITIAL_PROPOSAL,
} from "@/tests/fixtures/model-safety";

const baseEnvironment = {
  NODE_ENV: "test",
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://rewind_app:database-secret@localhost:5432/rewind",
  REWIND_STORAGE_MODE: "postgres",
  REWIND_SESSION_SECRET: "session-secret-012345678901234567890123",
  REWIND_DASHBOARD_PASSCODE: "dashboard-passcode-1234",
  MCP_BACKEND_TOKEN: "mcp-token-01234567890123456789012345",
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

describe("explicit product model selection", () => {
  it("uses only Ollama when local mode is explicit, even if stale OpenAI fields remain", async () => {
    const environment = parseApplicationEnvironment({
      ...baseEnvironment,
      REWIND_MODEL_RUNTIME: "local_ollama",
      REWIND_S043_MODEL_RUNTIME: "openai_responses",
      REWIND_LOCAL_MODEL: "qwen2.5-coder:latest",
      OPENAI_API_KEY: "sk-project-stale-key-012345678901",
      OPENAI_MODEL: "stale-openai-model",
    });
    let ollamaCalls = 0;
    let openAiCalls = 0;
    const model = createProductModel(environment, {
      ollamaClient: {
        createStructured: async (request) => {
          ollamaCalls += 1;
          return {
            parsed: MODEL_SAFETY_INITIAL_PROPOSAL,
            metadata: {
              provider: "ollama",
              model: request.model,
              promptVersion: request.promptVersion,
              schemaVersion: request.schemaVersion,
              reasoningEffort: "none",
              responseId: "ollama-product-selection-test",
              attempts: 1,
            },
          };
        },
      },
      openAiClient: {
        createStructured: async () => {
          openAiCalls += 1;
          throw new Error("OpenAI must not be called in explicit local mode.");
        },
      },
    });

    const response = await model.proposeInitial(MODEL_SAFETY_INITIAL_INPUT);
    expect(response.metadata).toMatchObject({ provider: "ollama", model: "qwen2.5-coder:latest" });
    expect(ollamaCalls).toBe(1);
    expect(openAiCalls).toBe(0);
    expect(productModelSelection(environment)).toEqual({
      runtime: "local_ollama",
      provider: "ollama",
      model: "qwen2.5-coder:latest",
      transport: "loopback",
    });
    expect(productLocalProofRuntime(environment)).toEqual({
      runtime: "local_ollama",
      evidenceClass: "local_model",
      provider: "ollama",
      model: "qwen2.5-coder:latest",
    });
  });

  it("selects OpenAI only through the explicit product selector", () => {
    const environment = parseApplicationEnvironment({
      ...baseEnvironment,
      REWIND_MODEL_RUNTIME: "openai_responses",
      REWIND_LOCAL_MODEL: "qwen2.5-coder:latest",
      OPENAI_API_KEY: "sk-project-explicit-key-012345678901",
      OPENAI_MODEL: "explicit-openai-model",
    });
    expect(productModelSelection(environment)).toEqual({
      runtime: "openai_responses",
      provider: "openai",
      model: "explicit-openai-model",
      transport: "external",
    });
    expect(() => productLocalProofRuntime(environment)).toThrowError(ProviderSpikeFailureError);
  });
});
