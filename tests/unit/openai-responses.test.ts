import { describe, expect, it } from "vitest";
import { OpenAIResponsesClient, OpenAIResponsesError, OPENAI_RESPONSES_ENDPOINT } from "@/lib/ai/openai-responses";

const apiKey = "unit-test-openai-key-that-must-never-be-printed";
const jsonSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};
const request = {
  model: "gpt-5.6-sol",
  input: [{ role: "system" as const, content: "Return the approved answer." }, { role: "user" as const, content: "Synthetic input." }],
  schemaName: "initial_proposal",
  jsonSchema,
  promptVersion: "initial.prompt.v1",
  schemaVersion: "initial-proposal.v1",
  reasoningEffort: "low",
  maxOutputTokens: 300,
};

function responseBody(answer: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: "resp_unit_s040",
    model: "gpt-5.6-sol-2026-01-01",
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
    usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("S040 OpenAI Responses client", () => {
  it("sends store false and strict Structured Outputs, then captures safe metadata", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new OpenAIResponsesClient({
      apiKey,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse(responseBody({ answer: "approved" }));
      },
    });

    const result = await client.createStructured(request);
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    const text = body.text as { format: Record<string, unknown> };

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(OPENAI_RESPONSES_ENDPOINT);
    expect(calls[0].init.headers).toMatchObject({ authorization: `Bearer ${apiKey}`, "content-type": "application/json" });
    expect(body).toMatchObject({ model: request.model, store: false, max_output_tokens: 300 });
    expect(text.format).toMatchObject({ type: "json_schema", name: request.schemaName, strict: true, schema: jsonSchema });
    expect(result.parsed).toEqual({ answer: "approved" });
    expect(result.metadata).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-sol-2026-01-01",
      promptVersion: request.promptVersion,
      schemaVersion: request.schemaVersion,
      reasoningEffort: "low",
      responseId: "resp_unit_s040",
      attempts: 1,
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    });
  });

  it("retries once with a safe validation instruction after malformed structured output", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let callCount = 0;
    const client = new OpenAIResponsesClient({
      apiKey,
      fetchImpl: async (_url, init) => {
        callCount += 1;
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return callCount === 1
          ? jsonResponse(responseBody(null, { output: [{ type: "message", content: [{ type: "output_text", text: "not-json" }] }] }))
          : jsonResponse(responseBody({ answer: "retry-approved" }));
      },
    });

    const result = await client.createStructured({ ...request, input: "Synthetic prompt." });
    expect(result.parsed).toEqual({ answer: "retry-approved" });
    expect(result.metadata.attempts).toBe(2);
    expect(JSON.stringify(bodies[1].input)).toContain("invalid_output");
    expect(JSON.stringify(bodies[1].input)).not.toContain("not-json");
  });

  it("handles refusal and truncation as typed failures without exposing provider content", async () => {
    const refusalClient = new OpenAIResponsesClient({
      apiKey,
      fetchImpl: async () =>
        jsonResponse(
          responseBody(null, {
            output: [{ type: "message", content: [{ type: "refusal", refusal: "sensitive provider refusal text" }] }],
          }),
        ),
    });
    await expect(refusalClient.createStructured(request)).rejects.toMatchObject({ kind: "refusal", attempts: 2 });
    await expect(refusalClient.createStructured(request)).rejects.not.toThrow("sensitive provider refusal text");

    const truncatedClient = new OpenAIResponsesClient({
      apiKey,
      fetchImpl: async () => jsonResponse(responseBody(null, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })),
    });
    await expect(truncatedClient.createStructured(request)).rejects.toMatchObject({ kind: "truncated", attempts: 2 });
  });

  it("retries an unavailable response once and then fails safely", async () => {
    let callCount = 0;
    const client = new OpenAIResponsesClient({
      apiKey,
      fetchImpl: async () => {
        callCount += 1;
        return jsonResponse({ error: { message: "provider secret detail" } }, 503);
      },
    });

    await expect(client.createStructured(request)).rejects.toEqual(expect.objectContaining({ kind: "unavailable", attempts: 2 }));
    expect(callCount).toBe(2);
    await expect(client.createStructured(request)).rejects.not.toThrow(apiKey);
  });

  it.each([
    [400, "invalid_request"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [422, "invalid_request"],
  ] as const)("classifies HTTP %i without retrying or exposing the response", async (status, kind) => {
    let callCount = 0;
    const client = new OpenAIResponsesClient({
      apiKey,
      fetchImpl: async () => {
        callCount += 1;
        return jsonResponse({ error: { message: `private ${apiKey}` } }, status);
      },
    });

    await expect(client.createStructured(request)).rejects.toMatchObject({ kind, attempts: 1 });
    expect(callCount).toBe(1);
    await expect(client.createStructured(request)).rejects.not.toThrow(apiKey);
  });

  it.each([
    [408, "timeout"],
    [409, "unavailable"],
    [429, "rate_limited"],
  ] as const)("classifies retryable HTTP %i and stops at the shared attempt ceiling", async (status, kind) => {
    let callCount = 0;
    const client = new OpenAIResponsesClient({
      apiKey,
      fetchImpl: async () => {
        callCount += 1;
        return jsonResponse({ error: { message: "private transient detail" } }, status);
      },
    });

    await expect(client.createStructured(request)).rejects.toMatchObject({ kind, attempts: 2 });
    expect(callCount).toBe(2);
  });

  it("classifies rate limits and honors a caller-owned one-attempt budget", async () => {
    let callCount = 0;
    const client = new OpenAIResponsesClient({
      apiKey,
      fetchImpl: async () => {
        callCount += 1;
        return jsonResponse({ error: { message: "private rate-limit detail" } }, 429);
      },
    });

    await expect(client.createStructured(request, { maxAttempts: 1 })).rejects.toMatchObject({ kind: "rate_limited", attempts: 1 });
    expect(callCount).toBe(1);
  });

  it("distinguishes a local timeout from provider unavailability", async () => {
    const client = new OpenAIResponsesClient({
      apiKey,
      timeoutMs: 10,
      fetchImpl: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        }),
    });

    await expect(client.createStructured(request, { maxAttempts: 1 })).rejects.toMatchObject({ kind: "timeout", attempts: 1 });
  });

  it("rejects non-strict schemas before making a provider request", async () => {
    let called = false;
    const client = new OpenAIResponsesClient({
      apiKey,
      fetchImpl: async () => {
        called = true;
        return jsonResponse(responseBody({ answer: "never" }));
      },
    });

    await expect(client.createStructured({ ...request, jsonSchema: { ...jsonSchema, additionalProperties: true } })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("exposes only the typed failure class for a client error", () => {
    const error = new OpenAIResponsesError("invalid_output", 2);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(apiKey);
  });
});
