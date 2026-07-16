import { z } from "zod";
import {
  InitialModelInputSchema,
  ModelOperationSchema,
  ModelProposalResponseSchema,
  RecoveryModelInputSchema,
  type InitialModelInput,
  type ModelMetadata,
  type ModelOperation,
  type ModelProposalResponse,
  type PreventionRuleModelInput,
  type RecoveryModelInput,
} from "@/lib/contracts/provider-ports";
import { assertAccountBriefIndependent } from "@/lib/domain/account-brief";
import {
  createInitialReasoningSchemaContract,
  createPreventionRuleProposalSchemaContract,
  createRecoveryProposalSchemaContract,
  type InitialReasoningProposal,
  type PreventionRuleProposal,
  type RecoveryProposal,
} from "@/lib/ai/model-schemas";
import { ModelProviderError, type ModelProposalPort, type ModelRetryContext } from "@/lib/ai/model";

export const MODEL_VALIDATION_MAX_ATTEMPTS = 2 as const;

export type ModelSafetyIssueCode =
  | "schema_invalid"
  | "candidate_universe_invalid"
  | "candidate_selection_invalid"
  | "assumption_invalid"
  | "dependency_graph_invalid"
  | "artifact_not_independent"
  | "explicit_target_required"
  | "correction_target_invalid"
  | "completed_action_invalid"
  | "decision_coverage_invalid"
  | "outcome_incompatible"
  | "unsafe_preserve"
  | "new_action_set_invalid"
  | "recipient_not_allowed"
  | "rule_source_invalid"
  | "fallback_forbidden";

export type ModelSafetyIssue = Readonly<{
  code: ModelSafetyIssueCode;
  path: string;
}>;

export type ModelSafetyFailureKind =
  | "schema_invalid"
  | "semantic_invalid"
  | "fallback_forbidden"
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

/**
 * Safe model failure. It intentionally contains no prompt, model output,
 * refusal text, recipient, or provider response.
 */
export class ModelSafetyError extends Error {
  readonly operation: ModelOperation;
  readonly kind: ModelSafetyFailureKind;
  readonly attempts: number;
  readonly issues: readonly ModelSafetyIssue[];

  constructor(
    operation: ModelOperation,
    kind: ModelSafetyFailureKind,
    attempts: number,
    issues: readonly ModelSafetyIssue[] = [],
  ) {
    super("Model output was rejected safely.");
    this.name = "ModelSafetyError";
    this.operation = operation;
    this.kind = kind;
    this.attempts = attempts;
    this.issues = [...issues];
  }
}

export type InitialProposalValidationContext = Readonly<{
  /** Deterministic provider ranking, never supplied by the model. */
  expectedSelectedCandidateId: string;
  expectedAccountBriefTitle?: string;
  expectedAccountBriefContent?: string;
  expectedDependencyEdges?: Readonly<Record<string, readonly string[]>>;
}>;

export type RecoveryCompletedAction = Readonly<{
  executedActionId: string;
  actionKey: "initial.artifact.account_brief" | "initial.calendar.move" | "initial.mail.notify";
  status: "planned" | "in_progress" | "succeeded" | "retryable_failed" | "delivery_uncertain" | "conflict" | "permanently_failed";
  dependsOnAssumptionIds: readonly string[];
}>;

export type RecoveryProposalValidationContext = Readonly<{
  initialSelectedCandidateId: string;
  /** `undefined` means the trusted correction parser found no explicit target. */
  explicitCorrectedCandidateId: string | undefined;
  completedActions: readonly RecoveryCompletedAction[];
  recipientSafety?: RecipientSafetyContext;
}>;

export type PreventionRuleValidationContext = Readonly<{
  expectedSourceTaskId: string;
}>;

export type RecipientSafetyContext = Readonly<{
  exactRecipientsByCandidate: Readonly<Record<string, readonly string[]>>;
  teamAllowlist: readonly string[];
}>;

export type ValidatedModelProposal<T> = Readonly<{
  proposal: T;
  metadata: ModelMetadata;
  attempts: number;
}>;

const INITIAL_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  "initial.artifact.account_brief": [],
  "initial.calendar.move": ["assumption_acme_region"],
  "initial.mail.notify": ["assumption_acme_region"],
};

const RECOVERY_OUTCOME_BY_ACTION: Readonly<
  Record<
    RecoveryCompletedAction["actionKey"],
    Readonly<{
      outcome: "restore" | "correct" | "preserve";
      reasonCode: "entity_dependency_invalidated" | "irreversible_effect_requires_correction" | "recorded_dependency_unchanged";
      dependencies: readonly string[];
    }>
  >
> = {
  "initial.artifact.account_brief": {
    outcome: "preserve",
    reasonCode: "recorded_dependency_unchanged",
    dependencies: [],
  },
  "initial.calendar.move": {
    outcome: "restore",
    reasonCode: "entity_dependency_invalidated",
    dependencies: ["assumption_acme_region"],
  },
  "initial.mail.notify": {
    outcome: "correct",
    reasonCode: "irreversible_effect_requires_correction",
    dependencies: ["assumption_acme_region"],
  },
};

function issue(code: ModelSafetyIssueCode, path: string): ModelSafetyIssue {
  return { code, path };
}

function pathOf(path: readonly (string | number)[]): string {
  return path.length === 0 ? "$" : path.map(String).join(".");
}

function schemaIssues(error: z.ZodError): readonly ModelSafetyIssue[] {
  return error.issues.map((entry) => issue("schema_invalid", pathOf(entry.path)));
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && right.every((value) => left.includes(value));
}

function throwValidation(operation: ModelOperation, issues: readonly ModelSafetyIssue[]): never {
  throw new ModelSafetyError(operation, "semantic_invalid", 1, issues);
}

function parseProposal<T>(operation: ModelOperation, rawOutput: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(rawOutput);
  if (!parsed.success) throw new ModelSafetyError(operation, "schema_invalid", 1, schemaIssues(parsed.error));
  return parsed.data;
}

function assertRecipientSafety(targetCandidateId: string, context: RecipientSafetyContext, operation: ModelOperation): void {
  const recipients = context.exactRecipientsByCandidate[targetCandidateId];
  const allowlist = context.teamAllowlist.map((address) => address.toLocaleLowerCase("en-US"));
  if (!recipients || recipients.length === 0) throw new ModelSafetyError(operation, "semantic_invalid", 1, [issue("recipient_not_allowed", "newActions")]);
  const normalized = recipients.map((address) => address.toLocaleLowerCase("en-US"));
  if (
    new Set(normalized).size !== normalized.length ||
    normalized.some((address) => !allowlist.includes(address))
  ) {
    throw new ModelSafetyError(operation, "semantic_invalid", 1, [issue("recipient_not_allowed", "newActions")]);
  }
}

/**
 * Resolve recipients only from the server-owned allowlist. Model output never
 * participates in this expansion.
 */
export function resolveRecoveryRecipients(
  targetCandidateId: string,
  context: RecipientSafetyContext,
): readonly string[] {
  assertRecipientSafety(targetCandidateId, context, "recovery");
  return [...context.exactRecipientsByCandidate[targetCandidateId]];
}

export function validateInitialReasoningProposal(
  rawOutput: unknown,
  input: InitialModelInput,
  context: InitialProposalValidationContext,
): InitialReasoningProposal {
  const parsedInput = InitialModelInputSchema.parse(input);
  const contract = createInitialReasoningSchemaContract(parsedInput);
  const proposal = parseProposal("initial", rawOutput, contract.outputSchema);
  const issues: ModelSafetyIssue[] = [];

  if (!parsedInput.allowedCandidateIds.includes(context.expectedSelectedCandidateId)) {
    issues.push(issue("candidate_universe_invalid", "expectedSelectedCandidateId"));
  }
  if (proposal.selectedCandidateId !== context.expectedSelectedCandidateId) {
    issues.push(issue("candidate_selection_invalid", "selectedCandidateId"));
  }
  if (proposal.assumption.resolvedCandidateId !== proposal.selectedCandidateId) {
    issues.push(issue("assumption_invalid", "assumption.resolvedCandidateId"));
  }

  const expectedDependencies = context.expectedDependencyEdges ?? INITIAL_DEPENDENCIES;
  const actualByAction = new Map<string, readonly string[]>();
  for (const edge of proposal.dependencyEdges) {
    if (actualByAction.has(edge.actionKey)) issues.push(issue("dependency_graph_invalid", "dependencyEdges"));
    actualByAction.set(edge.actionKey, edge.assumptionIds);
  }
  if (!sameSet([...actualByAction.keys()], parsedInput.allowedActionKeys)) {
    issues.push(issue("dependency_graph_invalid", "dependencyEdges"));
  }
  for (const actionKey of parsedInput.allowedActionKeys) {
    const expected = expectedDependencies[actionKey] ?? [];
    const actual = actualByAction.get(actionKey);
    if (!actual || !sameValues(actual, expected)) issues.push(issue("dependency_graph_invalid", `dependencyEdges.${actionKey}`));
  }

  if (context.expectedAccountBriefTitle !== undefined && proposal.accountBrief.title !== context.expectedAccountBriefTitle) {
    issues.push(issue("artifact_not_independent", "accountBrief.title"));
  }
  if (context.expectedAccountBriefContent !== undefined && proposal.accountBrief.content !== context.expectedAccountBriefContent) {
    issues.push(issue("artifact_not_independent", "accountBrief.content"));
  }
  try {
    assertAccountBriefIndependent(proposal.accountBrief.content);
  } catch {
    issues.push(issue("artifact_not_independent", "accountBrief.content"));
  }

  if (issues.length > 0) throwValidation("initial", issues);
  return proposal;
}

export function validateRecoveryProposal(
  rawOutput: unknown,
  input: RecoveryModelInput,
  context: RecoveryProposalValidationContext,
): RecoveryProposal {
  const parsedInput = RecoveryModelInputSchema.parse(input);
  const contract = createRecoveryProposalSchemaContract(parsedInput);
  const proposal = parseProposal("recovery", rawOutput, contract.outputSchema);
  const issues: ModelSafetyIssue[] = [];

  if (context.explicitCorrectedCandidateId === undefined) {
    issues.push(issue("explicit_target_required", "correctedAssumption.toCandidateId"));
  } else {
    if (!parsedInput.allowedCandidateIds.includes(context.explicitCorrectedCandidateId)) {
      issues.push(issue("correction_target_invalid", "correctedAssumption.toCandidateId"));
    }
    if (proposal.correctedAssumption.toCandidateId !== context.explicitCorrectedCandidateId) {
      issues.push(issue("correction_target_invalid", "correctedAssumption.toCandidateId"));
    }
  }
  if (proposal.correctedAssumption.fromCandidateId !== context.initialSelectedCandidateId) {
    issues.push(issue("correction_target_invalid", "correctedAssumption.fromCandidateId"));
  }
  if (proposal.correctedAssumption.fromCandidateId === proposal.correctedAssumption.toCandidateId) {
    issues.push(issue("correction_target_invalid", "correctedAssumption"));
  }

  const actionById = new Map<string, RecoveryCompletedAction>();
  for (const action of context.completedActions) {
    if (actionById.has(action.executedActionId)) issues.push(issue("completed_action_invalid", "completedActions"));
    actionById.set(action.executedActionId, action);
    const expected = RECOVERY_OUTCOME_BY_ACTION[action.actionKey];
    if (!expected || !sameValues([...action.dependsOnAssumptionIds], [...expected.dependencies])) {
      issues.push(issue("completed_action_invalid", `completedActions.${action.executedActionId}`));
    }
    if (action.status !== "succeeded") issues.push(issue("completed_action_invalid", `completedActions.${action.executedActionId}.status`));
  }
  const suppliedActionIds = context.completedActions.map((action) => action.executedActionId);
  if (!sameSet(suppliedActionIds, parsedInput.completedActionIds)) {
    issues.push(issue("completed_action_invalid", "completedActions"));
  }

  const decisionIds = proposal.decisions.map((decision) => decision.executedActionId);
  if (!sameSet(decisionIds, parsedInput.completedActionIds)) {
    issues.push(issue("decision_coverage_invalid", "decisions"));
  }
  const decisionsById = new Map<string, (typeof proposal.decisions)[number]>();
  for (const decision of proposal.decisions) {
    if (decisionsById.has(decision.executedActionId)) issues.push(issue("decision_coverage_invalid", "decisions"));
    decisionsById.set(decision.executedActionId, decision);
    const action = actionById.get(decision.executedActionId);
    const expected = action ? RECOVERY_OUTCOME_BY_ACTION[action.actionKey] : undefined;
    if (!action || !expected) {
      issues.push(issue("completed_action_invalid", `decisions.${decision.executedActionId}`));
      continue;
    }
    if (decision.outcome !== expected.outcome || decision.reasonCode !== expected.reasonCode) {
      issues.push(issue("outcome_incompatible", `decisions.${decision.executedActionId}`));
    }
    if (decision.outcome === "preserve" && expected.dependencies.length > 0) {
      issues.push(issue("unsafe_preserve", `decisions.${decision.executedActionId}`));
    }
  }

  const expectedTemplates = parsedInput.allowedNewActionTemplates;
  const actualTemplates = proposal.newActions.map((action) => action.template);
  if (!sameSet(actualTemplates, expectedTemplates)) issues.push(issue("new_action_set_invalid", "newActions"));
  for (const action of proposal.newActions) {
    if (context.explicitCorrectedCandidateId !== undefined && action.targetCandidateId !== context.explicitCorrectedCandidateId) {
      issues.push(issue("new_action_set_invalid", "newActions.targetCandidateId"));
    }
    if (action.targetCandidateId === proposal.correctedAssumption.fromCandidateId) {
      issues.push(issue("new_action_set_invalid", "newActions.targetCandidateId"));
    }
  }
  if (context.recipientSafety && context.explicitCorrectedCandidateId !== undefined) {
    try {
      assertRecipientSafety(context.explicitCorrectedCandidateId, context.recipientSafety, "recovery");
    } catch {
      issues.push(issue("recipient_not_allowed", "newActions"));
    }
  }

  if (issues.length > 0) throwValidation("recovery", issues);
  return proposal;
}

export function validatePreventionRuleProposal(
  rawOutput: unknown,
  input: PreventionRuleModelInput,
  context: PreventionRuleValidationContext,
): PreventionRuleProposal {
  const parsedInput = z.object({
    sourceTaskId: z.string(),
  }).strict().parse({ sourceTaskId: input.sourceTaskId });
  const contract = createPreventionRuleProposalSchemaContract(input);
  const proposal = parseProposal("prevention_rule", rawOutput, contract.outputSchema);
  const issues: ModelSafetyIssue[] = [];
  if (parsedInput.sourceTaskId !== context.expectedSourceTaskId || proposal.sourceTaskId !== context.expectedSourceTaskId) {
    issues.push(issue("rule_source_invalid", "sourceTaskId"));
  }
  if (!sameSet(input.candidateIds, [...new Set(input.candidateIds)])) {
    issues.push(issue("candidate_universe_invalid", "candidateIds"));
  }
  if (issues.length > 0) throwValidation("prevention_rule", issues);
  return proposal;
}

export function assertNoFallbackMetadata(metadata: ModelMetadata, operation: ModelOperation): void {
  if (metadata.provider === "openai" && metadata.source === "fallback") {
    throw new ModelSafetyError(operation, "fallback_forbidden", 1, [issue("fallback_forbidden", "metadata.source")]);
  }
}

function safeFailure(operation: ModelOperation, error: unknown, attempts: number): ModelSafetyError {
  if (error instanceof ModelSafetyError) return new ModelSafetyError(operation, error.kind, attempts, error.issues);
  if (error instanceof ModelProviderError) return new ModelSafetyError(operation, error.kind, attempts);
  return new ModelSafetyError(operation, "invalid_output", attempts);
}

function retryableFailure(kind: ModelSafetyFailureKind): boolean {
  return !["fallback_forbidden", "invalid_request", "unauthorized", "forbidden", "not_found"].includes(kind);
}

async function runValidatedProposal<T>(
  operation: ModelOperation,
  invoke: (retryContext?: ModelRetryContext) => Promise<ModelProposalResponse>,
  validate: (rawOutput: unknown) => T,
): Promise<ValidatedModelProposal<T>> {
  let lastFailure: ModelSafetyError | undefined;
  let retryContext: ModelRetryContext | undefined;
  for (let attempt = 1; attempt <= MODEL_VALIDATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = ModelProposalResponseSchema.parse(await invoke(retryContext));
      assertNoFallbackMetadata(response.metadata, operation);
      const proposal = validate(response.rawOutput);
      return { proposal, metadata: response.metadata, attempts: attempt };
    } catch (error) {
      lastFailure = safeFailure(operation, error, attempt);
      if (!retryableFailure(lastFailure.kind)) throw lastFailure;
      if (attempt < MODEL_VALIDATION_MAX_ATTEMPTS) {
        retryContext = {
          attempt: 2,
          reason: lastFailure.kind,
          issues: lastFailure.issues,
        };
      }
    }
  }
  throw lastFailure ?? new ModelSafetyError(operation, "invalid_output", MODEL_VALIDATION_MAX_ATTEMPTS);
}

/** Validate model output and retry at most once. There is deliberately no fallback path. */
export function requestValidatedInitialProposal(
  model: ModelProposalPort,
  input: InitialModelInput,
  context: InitialProposalValidationContext,
): Promise<ValidatedModelProposal<InitialReasoningProposal>> {
  return runValidatedProposal(
    "initial",
    (retryContext) => model.proposeInitial(input, retryContext),
    (rawOutput) => validateInitialReasoningProposal(rawOutput, input, context),
  );
}

/** Validate model output and retry at most once. There is deliberately no fallback path. */
export function requestValidatedRecoveryProposal(
  model: ModelProposalPort,
  input: RecoveryModelInput,
  context: RecoveryProposalValidationContext,
): Promise<ValidatedModelProposal<RecoveryProposal>> {
  return runValidatedProposal(
    "recovery",
    (retryContext) => model.proposeRecovery(input, retryContext),
    (rawOutput) => validateRecoveryProposal(rawOutput, input, context),
  );
}

/** Validate model output and retry at most once. There is deliberately no fallback path. */
export function requestValidatedPreventionRuleProposal(
  model: ModelProposalPort,
  input: PreventionRuleModelInput,
  context: PreventionRuleValidationContext,
): Promise<ValidatedModelProposal<PreventionRuleProposal>> {
  return runValidatedProposal(
    "prevention_rule",
    (retryContext) => model.proposePreventionRule(input, retryContext),
    (rawOutput) => validatePreventionRuleProposal(rawOutput, input, context),
  );
}

export function modelSafetyErrorSummary(error: unknown): Readonly<{ kind: string; attempts: number; issueCodes: readonly string[] }> {
  if (!(error instanceof ModelSafetyError)) return { kind: "unknown", attempts: 0, issueCodes: [] };
  return {
    kind: error.kind,
    attempts: error.attempts,
    issueCodes: [...new Set(error.issues.map((entry) => entry.code))],
  };
}

export const MODEL_SAFETY_OPERATION_SCHEMA = ModelOperationSchema;
