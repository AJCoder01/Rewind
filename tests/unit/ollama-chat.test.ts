import { describe, expect, it } from "vitest";
import {
  OLLAMA_CHAT_ENDPOINT,
  OllamaChatClient,
  ollamaGrammarSchema,
  type OllamaChatRequest,
} from "@/lib/ai/ollama-chat";

const jsonSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

const request: OllamaChatRequest = {
  model: "gemma3:4b",
  messages: [
    { role: "system", content: "Return the strict synthetic object." },
    { role: "user", content: "Synthetic input." },
  ],
  jsonSchema,
  promptVersion: "controlled-provider-spike.v2",
  schemaVersion: "initial-reasoning.v1",
  maxOutputTokens: 300,
};

function responseBody(content: unknown, overrides: Record<string, unknown> = {}) {
  return {
    model: "gemma3:4b",
    created_at: "2026-07-16T15:30:00Z",
    message: { role: "assistant", content: JSON.stringify(content) },
    done: true,
    done_reason: "stop",
    total_duration: 100,
    prompt_eval_count: 20,
    eval_count: 10,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("local Ollama structured-output client", () => {
  it("uses only the fixed loopback endpoint and native JSON Schema output", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new OllamaChatClient({
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return jsonResponse(responseBody({ answer: "approved" }));
      },
    });

    const result = await client.createStructured(request);
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(OLLAMA_CHAT_ENDPOINT);
    expect(calls[0].init.headers).toEqual({ "content-type": "application/json" });
    expect(body).toMatchObject({ model: "gemma3:4b", stream: false, format: jsonSchema, options: { temperature: 0, seed: 42, num_predict: 300 } });
    expect(result.parsed).toEqual({ answer: "approved" });
    expect(result.metadata).toMatchObject({ provider: "ollama", model: "gemma3:4b", reasoningEffort: "none", attempts: 1 });
    expect(result.metadata.responseId).toMatch(/^ollama-[a-f0-9]{32}$/);
  });

  it.each([
    [400, "invalid_request"],
    [404, "not_found"],
    [408, "timeout"],
    [429, "rate_limited"],
    [503, "unavailable"],
  ] as const)("classifies HTTP %i without reading provider text", async (status, kind) => {
    const client = new OllamaChatClient({
      fetchImpl: async () => jsonResponse({ error: "private local response text" }, status),
    });
    await expect(client.createStructured(request)).rejects.toMatchObject({ kind, attempts: 1 });
    await expect(client.createStructured(request)).rejects.not.toThrow("private local response text");
  });

  it("maps aborts to timeout and malformed JSON to invalid output", async () => {
    const timeoutClient = new OllamaChatClient({
      timeoutMs: 10,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    });
    await expect(timeoutClient.createStructured(request)).rejects.toMatchObject({ kind: "timeout" });

    const invalidClient = new OllamaChatClient({ fetchImpl: async () => new Response("not-json", { status: 200 }) });
    await expect(invalidClient.createStructured(request)).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("rejects cloud-backed model names before opening the loopback transport", async () => {
    let called = false;
    const client = new OllamaChatClient({
      fetchImpl: async () => {
        called = true;
        return jsonResponse(responseBody({ answer: "never" }));
      },
    });
    await expect(client.createStructured({ ...request, model: "remote:cloud" })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("rejects incomplete, mismatched-model, and non-JSON completions safely", async () => {
    const incomplete = new OllamaChatClient({ fetchImpl: async () => jsonResponse(responseBody({}, { done: false })) });
    await expect(incomplete.createStructured(request)).rejects.toMatchObject({ kind: "truncated" });

    const mismatch = new OllamaChatClient({ fetchImpl: async () => jsonResponse(responseBody({}, { model: "other-model" })) });
    await expect(mismatch.createStructured(request)).rejects.toMatchObject({ kind: "invalid_output" });

    const malformed = new OllamaChatClient({
      fetchImpl: async () => jsonResponse(responseBody({}, { message: { role: "assistant", content: "not-json" } })),
    });
    await expect(malformed.createStructured(request)).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("strips unsupported string bounds while retaining cardinality, numeric bounds, closed structure, and enums", () => {
    expect(ollamaGrammarSchema({
      type: "object",
      properties: {
        confidence: { type: "number", minimum: 0, maximum: 1 },
        target: { type: "string", enum: ["UK", "US"], minLength: 1 },
        values: { type: "array", items: { type: "string", maxLength: 10 }, minItems: 2, maxItems: 2 },
      },
      required: ["confidence", "target", "values"],
      additionalProperties: false,
    })).toEqual({
      type: "object",
      properties: {
        confidence: { type: "number", minimum: 0, maximum: 1 },
        target: { type: "string", enum: ["UK", "US"] },
        values: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
      },
      required: ["confidence", "target", "values"],
      additionalProperties: false,
    });
  });
});
