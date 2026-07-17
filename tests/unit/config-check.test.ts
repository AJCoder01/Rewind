import { describe, expect, it } from "vitest";
import { configuredModelRuntimes } from "@/scripts/config-check";

describe("sanitized configuration model summary", () => {
  it("reports product and historical provider-spike selectors independently", () => {
    expect(configuredModelRuntimes({
      REWIND_MODEL_RUNTIME: "local_ollama",
      REWIND_S043_MODEL_RUNTIME: "openai_responses",
    })).toEqual({
      productModelRuntime: "local_ollama",
      providerSpikeModelRuntime: "openai_responses",
    });
  });

  it("does not infer either selector from stale provider fields", () => {
    expect(configuredModelRuntimes({
      REWIND_LOCAL_MODEL: "qwen2.5-coder:latest",
      OPENAI_API_KEY: "stale-key",
      OPENAI_MODEL: "stale-model",
    })).toEqual({
      productModelRuntime: "not_configured",
      providerSpikeModelRuntime: "not_configured",
    });
  });
});
