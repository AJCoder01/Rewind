import { describe, expect, it } from "vitest";
import { OpenAIModelPort } from "@/lib/ai/openai-model";
import { requestValidatedInitialProposal } from "@/lib/ai/model-safety";
import { MODEL_SAFETY_INITIAL_CONTEXT, MODEL_SAFETY_INITIAL_INPUT, MODEL_SAFETY_INITIAL_PROPOSAL } from "@/tests/fixtures/model-safety";
import type { OpenAIResponsesRequest, OpenAIResponsesResult } from "@/lib/ai/openai-responses";

describe("OpenAI model proposal adapter", () => {
  it("binds a strict schema request to the versioned prompt and emits model metadata", async () => {
    let request: OpenAIResponsesRequest | undefined;
    const client = {
      createStructured: async (input: OpenAIResponsesRequest): Promise<OpenAIResponsesResult> => {
        request = input;
        return {
          parsed: MODEL_SAFETY_INITIAL_PROPOSAL,
          metadata: {
            provider: "openai",
            model: "test-model",
            promptVersion: "controlled-provider-spike.v1",
            schemaVersion: "initial-reasoning.v1",
            reasoningEffort: "low",
            responseId: "resp_test_123",
            attempts: 1,
          },
        };
      },
    };

    const model = new OpenAIModelPort({ client, model: "test-model" });
    const result = await requestValidatedInitialProposal(model, MODEL_SAFETY_INITIAL_INPUT, MODEL_SAFETY_INITIAL_CONTEXT);

    expect(result.proposal).toEqual(MODEL_SAFETY_INITIAL_PROPOSAL);
    expect(result.metadata).toMatchObject({ provider: "openai", source: "model", responseId: "resp_test_123" });
    expect(request?.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "developer" }),
      expect.objectContaining({ role: "user" }),
    ]));
    expect(request?.jsonSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(request?.promptVersion).toBe("controlled-provider-spike.v1");
    expect(JSON.stringify(request)).not.toContain("owner@example.com");
  });
});
