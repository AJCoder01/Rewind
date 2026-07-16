import { z } from "zod";
import { sha256Text } from "@/lib/domain/digest";
import type { ModelProviderFailureKind } from "@/lib/ai/model";

export const OLLAMA_CHAT_ENDPOINT = "http://127.0.0.1:11434/api/chat";
export const OLLAMA_CHAT_DEFAULT_TIMEOUT_MS = 180_000;

const OllamaMessageSchema = z
  .object({
    role: z.enum(["system", "user"]),
    content: z.string().min(1).max(100_000),
  })
  .strict();

const OllamaModelSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .refine((value) => !value.toLowerCase().endsWith(":cloud"), "Cloud-backed Ollama models are forbidden for the local runtime");

const JsonSchemaObjectSchema = z
  .record(z.unknown())
  .refine((value) => value.type === "object", "Structured output schema must have object type")
  .refine((value) => value.additionalProperties === false, "Structured output schema must reject additional properties")
  .refine((value) => Array.isArray(value.required), "Structured output schema must declare required properties");

export const OllamaChatRequestSchema = z
  .object({
    model: OllamaModelSchema,
    messages: z.array(OllamaMessageSchema).min(1).max(10),
    jsonSchema: JsonSchemaObjectSchema,
    promptVersion: z.string().min(1).max(100),
    schemaVersion: z.string().min(1).max(100),
    maxOutputTokens: z.number().int().min(1).max(16_384).default(2_048),
  })
  .strict();

export type OllamaChatRequest = z.input<typeof OllamaChatRequestSchema>;

const OllamaChatEnvelopeSchema = z
  .object({
    model: z.string().min(1).max(200),
    created_at: z.string().min(1).max(100),
    message: z
      .object({
        role: z.literal("assistant"),
        content: z.string(),
      })
      .passthrough(),
    done: z.boolean(),
    done_reason: z.string().min(1).max(100).optional(),
    total_duration: z.number().int().nonnegative().optional(),
    prompt_eval_count: z.number().int().nonnegative().optional(),
    eval_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type OllamaChatResult = Readonly<{
  parsed: unknown;
  metadata: Readonly<{
    provider: "ollama";
    model: string;
    promptVersion: string;
    schemaVersion: string;
    reasoningEffort: "none";
    responseId: string;
    attempts: 1;
    usage?: Readonly<{ inputTokens?: number; outputTokens?: number }>;
  }>;
}>;

export class OllamaChatError extends Error {
  readonly kind: ModelProviderFailureKind;
  readonly attempts = 1 as const;

  constructor(kind: ModelProviderFailureKind, cause?: unknown) {
    super("Local structured model output failed safely.", cause === undefined ? undefined : { cause });
    this.name = "OllamaChatError";
    this.kind = kind;
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type OllamaChatClientOptions = Readonly<{
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}>;

function failureForHttpStatus(status: number): ModelProviderFailureKind {
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  return "unavailable";
}

const OLLAMA_GRAMMAR_SCHEMA_KEYS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
]);

/**
 * Ollama's local grammar accepts the structural JSON Schema subset. The full
 * schema still appears in the trusted prompt and is enforced after generation
 * by the operation-specific Zod schema plus S042 semantic validation.
 */
export function ollamaGrammarSchema(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => ollamaGrammarSchema(item, parentKey));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (parentKey === "properties" || OLLAMA_GRAMMAR_SCHEMA_KEYS.has(key)) {
      output[key] = ollamaGrammarSchema(child, key);
    }
  }
  return output;
}

export class OllamaChatClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: OllamaChatClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? OLLAMA_CHAT_DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 10 || this.timeoutMs > 600_000) {
      throw new Error("Ollama timeout configuration is invalid.");
    }
  }

  async createStructured(request: OllamaChatRequest): Promise<OllamaChatResult> {
    const parsedRequest = OllamaChatRequestSchema.parse(request);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(OLLAMA_CHAT_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: parsedRequest.model,
            messages: parsedRequest.messages,
            stream: false,
            format: ollamaGrammarSchema(parsedRequest.jsonSchema),
            options: { temperature: 0, seed: 42, num_predict: parsedRequest.maxOutputTokens },
            keep_alive: "5m",
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (timedOut) throw new OllamaChatError("timeout", error);
        throw new OllamaChatError("unavailable", error);
      }

      if (!response.ok) throw new OllamaChatError(failureForHttpStatus(response.status));
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new OllamaChatError("invalid_output", error);
      }
      return this.parseResponse(payload, parsedRequest);
    } finally {
      clearTimeout(timer);
    }
  }

  private parseResponse(
    payload: unknown,
    request: z.output<typeof OllamaChatRequestSchema>,
  ): OllamaChatResult {
    const envelope = OllamaChatEnvelopeSchema.safeParse(payload);
    if (!envelope.success) throw new OllamaChatError("invalid_output", envelope.error);
    if (!envelope.data.done || envelope.data.done_reason === "length") throw new OllamaChatError("truncated");
    if (envelope.data.model !== request.model) throw new OllamaChatError("invalid_output");

    let parsed: unknown;
    try {
      parsed = JSON.parse(envelope.data.message.content);
    } catch (error) {
      throw new OllamaChatError("invalid_output", error);
    }

    const receiptMaterial = [
      envelope.data.model,
      envelope.data.created_at,
      envelope.data.total_duration ?? 0,
      envelope.data.prompt_eval_count ?? 0,
      envelope.data.eval_count ?? 0,
    ].join("\0");
    return {
      parsed,
      metadata: {
        provider: "ollama",
        model: envelope.data.model,
        promptVersion: request.promptVersion,
        schemaVersion: request.schemaVersion,
        reasoningEffort: "none",
        responseId: `ollama-${sha256Text(receiptMaterial).slice(7, 39)}`,
        attempts: 1,
        usage: {
          inputTokens: envelope.data.prompt_eval_count,
          outputTokens: envelope.data.eval_count,
        },
      },
    };
  }
}
