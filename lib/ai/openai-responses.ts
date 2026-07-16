import { z } from "zod";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_INPUT_LENGTH = 50_000;

const OpenAIInputMessageSchema = z
  .object({
    role: z.enum(["developer", "system", "user"]),
    content: z.string().min(1).max(MAX_INPUT_LENGTH),
  })
  .strict();

const JsonSchemaObjectSchema = z
  .record(z.unknown())
  .refine((value) => value.type === "object", "Structured output schema must have object type")
  .refine((value) => value.additionalProperties === false, "Structured output schema must reject additional properties")
  .refine((value) => Array.isArray(value.required), "Structured output schema must declare required properties");

export const OpenAIResponsesRequestSchema = z
  .object({
    model: z.string().min(1).max(128),
    input: z.union([z.string().min(1).max(MAX_INPUT_LENGTH), z.array(OpenAIInputMessageSchema).min(1).max(20)]),
    schemaName: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    jsonSchema: JsonSchemaObjectSchema,
    promptVersion: z.string().min(1).max(100),
    schemaVersion: z.string().min(1).max(100),
    reasoningEffort: z.string().min(1).max(32).optional(),
    maxOutputTokens: z.number().int().min(1).max(16_384).default(2_048),
  })
  .strict();

export type OpenAIResponsesRequest = z.input<typeof OpenAIResponsesRequestSchema>;

const OpenAIUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const OpenAIResponseEnvelopeSchema = z
  .object({
    id: z.string().min(1).max(200),
    model: z.string().min(1).max(128),
    status: z.string().min(1).max(64).optional(),
    output: z.array(z.unknown()).optional(),
    output_text: z.string().optional(),
    incomplete_details: z.object({ reason: z.string().min(1).max(100).optional() }).passthrough().optional(),
    usage: OpenAIUsageSchema.optional(),
  })
  .passthrough();

export type OpenAIResponsesMetadata = Readonly<{
  provider: "openai";
  model: string;
  promptVersion: string;
  schemaVersion: string;
  reasoningEffort: string;
  responseId: string;
  attempts: number;
  usage?: Readonly<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
}>;

export type OpenAIResponsesResult = Readonly<{
  parsed: unknown;
  metadata: OpenAIResponsesMetadata;
}>;

export type OpenAIResponsesFailureKind = "unavailable" | "refusal" | "truncated" | "invalid_output";

export class OpenAIResponsesError extends Error {
  readonly kind: OpenAIResponsesFailureKind;
  readonly attempts: number;

  constructor(kind: OpenAIResponsesFailureKind, attempts: number, cause?: unknown) {
    super("OpenAI structured model output failed safely.", cause === undefined ? undefined : { cause });
    this.name = "OpenAIResponsesError";
    this.kind = kind;
    this.attempts = attempts;
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type OpenAIResponsesClientOptions = Readonly<{
  apiKey: string;
  fetchImpl?: FetchLike;
  endpoint?: string;
  timeoutMs?: number;
}>;

function safeRetryInput(input: OpenAIResponsesRequest["input"], failure: OpenAIResponsesFailureKind): OpenAIResponsesRequest["input"] {
  const retryMessage = `The previous structured-output attempt failed validation (${failure}). Return only an object matching the supplied schema; do not add properties or explanatory text.`;
  if (typeof input === "string") return `${input}\n\n${retryMessage}`.slice(0, MAX_INPUT_LENGTH);
  return [...input, { role: "developer" as const, content: retryMessage }].slice(-20);
}

function usageOf(value: z.infer<typeof OpenAIUsageSchema> | undefined): OpenAIResponsesMetadata["usage"] {
  if (!value) return undefined;
  return {
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    totalTokens: value.total_tokens,
  };
}

function extractStructuredText(output: readonly unknown[] | undefined, outputText: string | undefined): { kind: "text" | "refusal"; value: string } | null {
  if (outputText !== undefined && outputText.trim() !== "") return { kind: "text", value: outputText };
  for (const item of output ?? []) {
    if (!item || typeof item !== "object") continue;
    const itemRecord = item as Record<string, unknown>;
    if (itemRecord.type !== "message" || !Array.isArray(itemRecord.content)) continue;
    for (const content of itemRecord.content) {
      if (!content || typeof content !== "object") continue;
      const contentRecord = content as Record<string, unknown>;
      if (contentRecord.type === "refusal" && typeof contentRecord.refusal === "string") {
        return { kind: "refusal", value: contentRecord.refusal };
      }
      if (contentRecord.type === "output_text" && typeof contentRecord.text === "string") {
        return { kind: "text", value: contentRecord.text };
      }
    }
  }
  return null;
}

export class OpenAIResponsesClient {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAIResponsesClientOptions) {
    if (options.apiKey.trim() === "" || /\s/.test(options.apiKey)) throw new Error("OpenAI API key configuration is invalid.");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = options.endpoint ?? OPENAI_RESPONSES_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async createStructured(request: OpenAIResponsesRequest): Promise<OpenAIResponsesResult> {
    const parsedRequest = OpenAIResponsesRequestSchema.parse(request);
    let input = parsedRequest.input;
    let lastFailure: OpenAIResponsesError | undefined;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await this.send(parsedRequest, input);
        return this.parseResponse(response, parsedRequest, attempt);
      } catch (error) {
        const failure = error instanceof OpenAIResponsesError ? new OpenAIResponsesError(error.kind, attempt, error) : new OpenAIResponsesError("unavailable", attempt, error);
        lastFailure = failure;
        if (attempt === 2) throw failure;
        input = safeRetryInput(input, failure.kind);
      }
    }
    throw lastFailure ?? new OpenAIResponsesError("unavailable", 2);
  }

  private async send(request: z.output<typeof OpenAIResponsesRequestSchema>, input: OpenAIResponsesRequest["input"]): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          store: false,
          input,
          max_output_tokens: request.maxOutputTokens,
          ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
          text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.jsonSchema } },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new OpenAIResponsesError("unavailable", 1);
      return await response.json();
    } catch (error) {
      if (error instanceof OpenAIResponsesError) throw error;
      throw new OpenAIResponsesError("unavailable", 1, error);
    } finally {
      clearTimeout(timer);
    }
  }

  private parseResponse(response: unknown, request: z.output<typeof OpenAIResponsesRequestSchema>, attempt: number): OpenAIResponsesResult {
    const parsed = OpenAIResponseEnvelopeSchema.safeParse(response);
    if (!parsed.success) throw new OpenAIResponsesError("invalid_output", attempt, parsed.error);
    if (parsed.data.status === "incomplete" || parsed.data.incomplete_details) throw new OpenAIResponsesError("truncated", attempt);

    const extracted = extractStructuredText(parsed.data.output, parsed.data.output_text);
    if (!extracted) throw new OpenAIResponsesError("invalid_output", attempt);
    if (extracted.kind === "refusal") throw new OpenAIResponsesError("refusal", attempt);

    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(extracted.value);
    } catch (error) {
      throw new OpenAIResponsesError("invalid_output", attempt, error);
    }

    return {
      parsed: parsedOutput,
      metadata: {
        provider: "openai",
        model: parsed.data.model,
        promptVersion: request.promptVersion,
        schemaVersion: request.schemaVersion,
        reasoningEffort: request.reasoningEffort ?? "default",
        responseId: parsed.data.id,
        attempts: attempt,
        usage: usageOf(parsed.data.usage),
      },
    };
  }
}

export const OPENAI_RESPONSES_ENDPOINT = OPENAI_RESPONSES_URL;
