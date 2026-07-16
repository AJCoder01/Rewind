import { describe, expect, it } from "vitest";
import { OllamaModelPort } from "@/lib/ai/ollama-model";
import { OllamaChatError, type OllamaChatRequest, type OllamaChatResult } from "@/lib/ai/ollama-chat";
import { requestValidatedInitialProposal } from "@/lib/ai/model-safety";
import {
  MODEL_SAFETY_INITIAL_CONTEXT,
  MODEL_SAFETY_INITIAL_INPUT,
  MODEL_SAFETY_INITIAL_PROPOSAL,
} from "@/tests/fixtures/model-safety";

describe("local Ollama model proposal adapter", () => {
  it("binds the same strict schema, prompt, and semantic validator to local inference", async () => {
    let request: OllamaChatRequest | undefined;
    const client = {
      createStructured: async (input: OllamaChatRequest): Promise<OllamaChatResult> => {
        request = input;
        return {
          parsed: MODEL_SAFETY_INITIAL_PROPOSAL,
          metadata: {
            provider: "ollama",
            model: "gemma3:4b",
            promptVersion: "controlled-provider-spike.v2",
            schemaVersion: "initial-reasoning.v1",
            reasoningEffort: "none",
            responseId: "ollama-test-receipt",
            attempts: 1,
          },
        };
      },
    };

    const model = new OllamaModelPort({ client, model: "gemma3:4b" });
    const result = await requestValidatedInitialProposal(model, MODEL_SAFETY_INITIAL_INPUT, MODEL_SAFETY_INITIAL_CONTEXT);

    expect(result.proposal).toEqual(MODEL_SAFETY_INITIAL_PROPOSAL);
    expect(result.metadata).toMatchObject({ provider: "ollama", source: "model", model: "gemma3:4b", reasoningEffort: "none" });
    expect(request?.jsonSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(request?.messages[0]).toMatchObject({ role: "system" });
    expect(request?.messages[0].content).toContain("Required JSON Schema");
    expect(JSON.stringify(request)).not.toContain("owner@example.com");
  });

  it("keeps the complete model path to two local calls", async () => {
    let calls = 0;
    const model = new OllamaModelPort({
      client: {
        createStructured: async (): Promise<never> => {
          calls += 1;
          throw new OllamaChatError("invalid_output");
        },
      },
      model: "gemma3:4b",
    });
    await expect(requestValidatedInitialProposal(model, MODEL_SAFETY_INITIAL_INPUT, MODEL_SAFETY_INITIAL_CONTEXT)).rejects.toMatchObject({
      kind: "invalid_output",
      attempts: 2,
    });
    expect(calls).toBe(2);
  });
});
