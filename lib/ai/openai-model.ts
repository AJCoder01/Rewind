import {
  createInitialReasoningSchemaContract,
  createPreventionRuleProposalSchemaContract,
  createRecoveryProposalSchemaContract,
} from "@/lib/ai/model-schemas";
import { buildModelPrompt, MODEL_PROMPT_VERSION } from "@/lib/ai/prompts";
import type { ModelProposalPort, ModelRetryContext } from "@/lib/ai/model";
import { OpenAIResponsesClient, OpenAIResponsesError, type OpenAIResponsesRequest } from "@/lib/ai/openai-responses";
import { ModelProviderError } from "@/lib/ai/model";
import { MODEL_TRUSTED_FACTS, type ModelTrustedFacts } from "@/lib/ai/model-trusted-facts";
import {
  ModelProposalResponseSchema,
  type InitialModelInput,
  type ModelMetadata,
  type ModelOperation,
  type ModelProposalResponse,
  type PreventionRuleModelInput,
  type RecoveryModelInput,
} from "@/lib/contracts/provider-ports";

export type OpenAIModelPortOptions = Readonly<{
  client: Pick<OpenAIResponsesClient, "createStructured">;
  model: string;
  reasoningEffort?: string;
  maxOutputTokens?: number;
}>;

export type OpenAIModelTrustedFacts = ModelTrustedFacts;

export class OpenAIModelPort implements ModelProposalPort {
  private readonly client: Pick<OpenAIResponsesClient, "createStructured">;
  private readonly model: string;
  private readonly reasoningEffort: string;
  private readonly maxOutputTokens: number;
  private readonly trustedFacts: OpenAIModelTrustedFacts;

  constructor(options: OpenAIModelPortOptions & Partial<{ trustedFacts: OpenAIModelTrustedFacts }>) {
    this.client = options.client;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort ?? "low";
    this.maxOutputTokens = options.maxOutputTokens ?? 2_048;
    this.trustedFacts = options.trustedFacts ?? MODEL_TRUSTED_FACTS;
  }

  async proposeInitial(input: InitialModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse> {
    const contract = createInitialReasoningSchemaContract(input);
    return this.request("initial", input, contract, this.trustedFacts.initial, retryContext);
  }

  async proposeRecovery(input: RecoveryModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse> {
    const contract = createRecoveryProposalSchemaContract(input);
    return this.request("recovery", input, contract, this.trustedFacts.recovery, retryContext);
  }

  async proposePreventionRule(input: PreventionRuleModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse> {
    const contract = createPreventionRuleProposalSchemaContract(input);
    return this.request("prevention_rule", input, contract, this.trustedFacts.prevention_rule, retryContext);
  }

  private async request(
    operation: ModelOperation,
    input: unknown,
    contract: Readonly<{ schemaName: string; schemaVersion: string; jsonSchema: Readonly<Record<string, unknown>> }>,
    trustedFacts: unknown,
    retryContext?: ModelRetryContext,
  ): Promise<ModelProposalResponse> {
    const prompt = buildModelPrompt(operation, input, trustedFacts, retryContext);
    const request: OpenAIResponsesRequest = {
      model: this.model,
      input: [
        { role: "developer", content: prompt.developer },
        { role: "user", content: prompt.user },
      ],
      schemaName: contract.schemaName,
      jsonSchema: contract.jsonSchema,
      promptVersion: MODEL_PROMPT_VERSION,
      schemaVersion: contract.schemaVersion,
      reasoningEffort: this.reasoningEffort,
      maxOutputTokens: this.maxOutputTokens,
    };
    let result: Awaited<ReturnType<OpenAIResponsesClient["createStructured"]>>;
    try {
      // The outer S042 validator owns the one allowed retry so the complete
      // model path can never amplify two logical attempts into four HTTP calls.
      result = await this.client.createStructured(request, { maxAttempts: 1 });
    } catch (error) {
      if (error instanceof OpenAIResponsesError) throw new ModelProviderError(error.kind);
      throw error;
    }
    const metadata: ModelMetadata = {
      provider: "openai",
      model: result.metadata.model,
      promptVersion: result.metadata.promptVersion,
      schemaVersion: result.metadata.schemaVersion,
      reasoningEffort: result.metadata.reasoningEffort,
      ...(result.metadata.responseId ? { responseId: result.metadata.responseId } : {}),
      source: "model",
    };
    return ModelProposalResponseSchema.parse({ kind: operation, rawOutput: result.parsed, metadata });
  }
}
