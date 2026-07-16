import { describe, expect, it } from "vitest";
import { OpenAIModelPort } from "@/lib/ai/openai-model";
import { requestValidatedInitialProposal } from "@/lib/ai/model-safety";
import { OpenAIResponsesError } from "@/lib/ai/openai-responses";
import { MODEL_SAFETY_INITIAL_CONTEXT, MODEL_SAFETY_INITIAL_INPUT, MODEL_SAFETY_INITIAL_PROPOSAL } from "@/tests/fixtures/model-safety";
import type { OpenAIResponsesAttemptOptions, OpenAIResponsesRequest, OpenAIResponsesResult } from "@/lib/ai/openai-responses";

describe("OpenAI model proposal adapter", () => {
  it("binds a strict schema request to the versioned prompt and emits model metadata", async () => {
    let request: OpenAIResponsesRequest | undefined;
    let attemptOptions: OpenAIResponsesAttemptOptions | undefined;
    const client = {
      createStructured: async (input: OpenAIResponsesRequest, options?: OpenAIResponsesAttemptOptions): Promise<OpenAIResponsesResult> => {
        request = input;
        attemptOptions = options;
        return {
          parsed: MODEL_SAFETY_INITIAL_PROPOSAL,
          metadata: {
            provider: "openai",
            model: "test-model",
            promptVersion: "controlled-provider-spike.v2",
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
    expect(request?.promptVersion).toBe("controlled-provider-spike.v2");
    expect(attemptOptions).toEqual({ maxAttempts: 1 });
    expect(JSON.stringify(request)).not.toContain("owner@example.com");
  });

  it("preserves safe Responses failure kinds through the model port", async () => {
    let calls = 0;
    const model = new OpenAIModelPort({
      client: {
        createStructured: async (_request, options): Promise<never> => {
          calls += 1;
          expect(options).toEqual({ maxAttempts: 1 });
          throw new OpenAIResponsesError("truncated", 2);
        },
      },
      model: "test-model",
    });

    await expect(requestValidatedInitialProposal(model, MODEL_SAFETY_INITIAL_INPUT, MODEL_SAFETY_INITIAL_CONTEXT)).rejects.toMatchObject({
      kind: "truncated",
      attempts: 2,
    });
    expect(calls).toBe(2);
  });
});
