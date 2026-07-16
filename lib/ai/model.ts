import { z } from "zod";
import {
  InitialModelInputSchema,
  ModelProposalResponseSchema,
  ModelOperationSchema,
  PreventionRuleModelInputSchema,
  RecoveryModelInputSchema,
  type InitialModelInput,
  type ModelMetadata,
  type ModelOperation,
  type ModelProposalResponse,
  type PreventionRuleModelInput,
  type RecoveryModelInput,
} from "@/lib/contracts/provider-ports";

export type ModelProviderFailureKind =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "refusal"
  | "truncated"
  | "invalid_output";

export type ModelRetryContext = Readonly<{
  attempt: 2;
  reason: ModelProviderFailureKind | "schema_invalid" | "semantic_invalid" | "fallback_forbidden";
  issues: readonly Readonly<{ code: string; path: string }>[];
}>;

export class ModelProviderError extends Error {
  readonly kind: ModelProviderFailureKind;

  constructor(kind: ModelProviderFailureKind) {
    super("Model proposal failed safely.");
    this.name = "ModelProviderError";
    this.kind = kind;
  }
}

export interface ModelProposalPort {
  proposeInitial(input: InitialModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse>;
  proposeRecovery(input: RecoveryModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse>;
  proposePreventionRule(input: PreventionRuleModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse>;
}

export type FakeModelFailure = Readonly<{ operation: ModelOperation; kind: ModelProviderFailureKind }>;

export type FakeModelOptions = Readonly<{
  outputs: Partial<Record<ModelOperation, unknown>>;
  failures?: readonly FakeModelFailure[];
  metadata?: Partial<Record<ModelOperation, ModelMetadata>>;
}>;

/** Deterministic model boundary; raw output remains unknown until later strict schemas validate it. */
export class FakeModelPort implements ModelProposalPort {
  private readonly outputs: Partial<Record<ModelOperation, unknown>>;
  private readonly failures: readonly FakeModelFailure[];
  private readonly metadata: Partial<Record<ModelOperation, ModelMetadata>>;
  private readonly calls: ModelOperation[] = [];

  constructor(options: FakeModelOptions) {
    this.outputs = options.outputs;
    this.failures = options.failures ?? [];
    this.metadata = options.metadata ?? {};
  }

  async proposeInitial(input: InitialModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse> {
    void retryContext;
    return this.run("initial", InitialModelInputSchema, input);
  }

  async proposeRecovery(input: RecoveryModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse> {
    void retryContext;
    return this.run("recovery", RecoveryModelInputSchema, input);
  }

  async proposePreventionRule(input: PreventionRuleModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse> {
    void retryContext;
    return this.run("prevention_rule", PreventionRuleModelInputSchema, input);
  }

  getCalls(): readonly ModelOperation[] {
    return [...this.calls];
  }

  private async run<TInput>(operation: ModelOperation, schema: z.ZodType<TInput>, input: TInput): Promise<ModelProposalResponse> {
    const parsedInput = schema.parse(input);
    void parsedInput;
    this.calls.push(ModelOperationSchema.parse(operation));
    const failure = this.failures.find((candidate) => candidate.operation === operation);
    if (failure) throw new ModelProviderError(failure.kind);
    if (!Object.prototype.hasOwnProperty.call(this.outputs, operation)) throw new ModelProviderError("unavailable");
    const metadata =
      this.metadata[operation] ??
      ({
        provider: "fixture",
        model: "fixture-model",
        promptVersion: `${operation}.prompt.v1`,
        schemaVersion: `${operation}.proposal.v1`,
        reasoningEffort: "none",
        source: "fixture",
      } satisfies ModelMetadata);
    return ModelProposalResponseSchema.parse({ kind: operation, rawOutput: this.outputs[operation], metadata });
  }
}
