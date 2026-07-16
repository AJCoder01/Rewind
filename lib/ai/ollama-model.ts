import {
  createInitialReasoningSchemaContract,
  createPreventionRuleProposalSchemaContract,
  createRecoveryProposalSchemaContract,
} from "@/lib/ai/model-schemas";
import { buildModelPrompt, MODEL_PROMPT_VERSION } from "@/lib/ai/prompts";
import { ModelProviderError, type ModelProposalPort, type ModelRetryContext } from "@/lib/ai/model";
import { MODEL_TRUSTED_FACTS } from "@/lib/ai/model-trusted-facts";
import { OllamaChatClient, OllamaChatError, type OllamaChatRequest } from "@/lib/ai/ollama-chat";
import {
  ModelProposalResponseSchema,
  type InitialModelInput,
  type ModelMetadata,
  type ModelOperation,
  type ModelProposalResponse,
  type PreventionRuleModelInput,
  type RecoveryModelInput,
} from "@/lib/contracts/provider-ports";

export type OllamaModelPortOptions = Readonly<{
  client: Pick<OllamaChatClient, "createStructured">;
  model: string;
  maxOutputTokens?: number;
}>;

export class OllamaModelPort implements ModelProposalPort {
  private readonly client: Pick<OllamaChatClient, "createStructured">;
  private readonly model: string;
  private readonly maxOutputTokens: number;

  constructor(options: OllamaModelPortOptions) {
    this.client = options.client;
    this.model = options.model;
    this.maxOutputTokens = options.maxOutputTokens ?? 2_048;
  }

  proposeInitial(input: InitialModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse> {
    return this.request("initial", input, createInitialReasoningSchemaContract(input), MODEL_TRUSTED_FACTS.initial, retryContext);
  }

  proposeRecovery(input: RecoveryModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse> {
    return this.request("recovery", input, createRecoveryProposalSchemaContract(input), MODEL_TRUSTED_FACTS.recovery, retryContext);
  }

  proposePreventionRule(input: PreventionRuleModelInput, retryContext?: ModelRetryContext): Promise<ModelProposalResponse> {
    return this.request("prevention_rule", input, createPreventionRuleProposalSchemaContract(input), MODEL_TRUSTED_FACTS.prevention_rule, retryContext);
  }

  private async request(
    operation: ModelOperation,
    input: unknown,
    contract: Readonly<{ schemaName: string; schemaVersion: string; jsonSchema: Readonly<Record<string, unknown>> }>,
    trustedFacts: unknown,
    retryContext?: ModelRetryContext,
  ): Promise<ModelProposalResponse> {
    const prompt = buildModelPrompt(operation, input, trustedFacts, retryContext);
    const request: OllamaChatRequest = {
      model: this.model,
      messages: [
        { role: "system", content: `${prompt.developer} Required JSON Schema: ${JSON.stringify(contract.jsonSchema)}` },
        { role: "user", content: prompt.user },
      ],
      jsonSchema: contract.jsonSchema,
      promptVersion: MODEL_PROMPT_VERSION,
      schemaVersion: contract.schemaVersion,
      maxOutputTokens: this.maxOutputTokens,
    };
    let result: Awaited<ReturnType<OllamaChatClient["createStructured"]>>;
    try {
      result = await this.client.createStructured(request);
    } catch (error) {
      if (error instanceof OllamaChatError) throw new ModelProviderError(error.kind);
      throw error;
    }
    const metadata: ModelMetadata = {
      provider: "ollama",
      model: result.metadata.model,
      promptVersion: result.metadata.promptVersion,
      schemaVersion: result.metadata.schemaVersion,
      reasoningEffort: "none",
      responseId: result.metadata.responseId,
      source: "model",
    };
    return ModelProposalResponseSchema.parse({ kind: operation, rawOutput: result.parsed, metadata });
  }
}
