import {
  createInitialReasoningSchemaContract,
  createPreventionRuleProposalSchemaContract,
  createRecoveryProposalSchemaContract,
} from "@/lib/ai/model-schemas";
import { buildModelPrompt, MODEL_PROMPT_VERSION } from "@/lib/ai/prompts";
import type { ModelProposalPort, ModelRetryContext } from "@/lib/ai/model";
import { OpenAIResponsesClient, type OpenAIResponsesRequest } from "@/lib/ai/openai-responses";
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

export type OpenAIModelTrustedFacts = Readonly<{
  initial: unknown;
  recovery: unknown;
  prevention_rule: unknown;
}>;

const DEFAULT_TRUSTED_FACTS: OpenAIModelTrustedFacts = {
  initial: { expectedSelectedCandidateId: "cal_event_acme_uk", expectedAccountBriefTitle: "Acme parent-account renewal risk brief" },
  recovery: {
    initialSelectedCandidateId: "cal_event_acme_uk",
    explicitCorrectedCandidateId: "cal_event_acme_us",
    completedActions: [
      { executedActionId: "actexec_initial_artifact", actionKey: "initial.artifact.account_brief", status: "succeeded", dependsOnAssumptionIds: [] },
      { executedActionId: "actexec_initial_calendar", actionKey: "initial.calendar.move", status: "succeeded", dependsOnAssumptionIds: ["assumption_acme_region"] },
      { executedActionId: "actexec_initial_mail", actionKey: "initial.mail.notify", status: "succeeded", dependsOnAssumptionIds: ["assumption_acme_region"] },
    ],
    requiredDecisions: {
      actexec_initial_artifact: "preserve",
      actexec_initial_calendar: "restore",
      actexec_initial_mail: "correct",
    },
    newActionTargets: {
      "calendar.apply_to_correct_entity": "cal_event_acme_us",
      "mail.notify_correct_attendees": "cal_event_acme_us",
    },
  },
  prevention_rule: { expectedSourceTaskId: "task_source_s042" },
};

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
    this.trustedFacts = options.trustedFacts ?? DEFAULT_TRUSTED_FACTS;
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
    const result = await this.client.createStructured(request);
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
