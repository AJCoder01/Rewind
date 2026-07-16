import { z } from "zod";
import {
  InitialModelInputSchema,
  PreventionRuleModelInputSchema,
  RecoveryModelInputSchema,
  type InitialModelInput,
  type PreventionRuleModelInput,
  type RecoveryModelInput,
} from "@/lib/contracts/provider-ports";

export const INITIAL_REASONING_SCHEMA_VERSION = "initial-reasoning.v1" as const;
export const RECOVERY_PROPOSAL_SCHEMA_VERSION = "recovery-proposal.v1" as const;
export const PREVENTION_RULE_PROPOSAL_SCHEMA_VERSION = "prevention-rule-proposal.v1" as const;

export const MODEL_OUTPUT_SCHEMA_NAMES = {
  initial: "initial_reasoning_v1",
  recovery: "recovery_proposal_v1",
  preventionRule: "prevention_rule_proposal_v1",
} as const;

const AssumptionIdSchema = z.literal("assumption_acme_region");
const RecoveryReasonCodeSchema = z.enum([
  "entity_dependency_invalidated",
  "irreversible_effect_requires_correction",
  "recorded_dependency_unchanged",
]);

const jsonString = (extra: Record<string, unknown> = {}) => ({ type: "string", ...extra });
const jsonArray = (items: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "array",
  items,
  ...extra,
});
const strictJsonObject = (properties: Record<string, Record<string, unknown>>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

function closedValueSchema(values: readonly string[], label: string) {
  const allowed = new Set(values);
  return z
    .string()
    .min(1)
    .max(512)
    .refine((value) => allowed.has(value), `${label} must belong to the supplied closed universe`);
}

export type ModelOnlySchemaContract<T> = Readonly<{
  schemaName: string;
  schemaVersion: string;
  outputSchema: z.ZodType<T>;
  jsonSchema: Readonly<Record<string, unknown>>;
}>;

export type InitialReasoningProposal = Readonly<{
  schemaVersion: typeof INITIAL_REASONING_SCHEMA_VERSION;
  selectedCandidateId: string;
  assumption: Readonly<{
    assumptionId: "assumption_acme_region";
    statement: string;
    resolvedCandidateId: string;
    evidence: string[];
    confidence: number;
  }>;
  dependencyEdges: Array<Readonly<{ actionKey: string; assumptionIds: Array<"assumption_acme_region"> }>>;
  accountBrief: Readonly<{ title: string; content: string; sourceId: "acme_parent_account_notes" }>;
}>;

export type RecoveryProposal = Readonly<{
  schemaVersion: typeof RECOVERY_PROPOSAL_SCHEMA_VERSION;
  correctedAssumption: Readonly<{
    assumptionId: "assumption_acme_region";
    fromCandidateId: string;
    toCandidateId: string;
  }>;
  decisions: Array<
    Readonly<{
      executedActionId: string;
      outcome: "restore" | "correct" | "preserve";
      reasonCode: z.infer<typeof RecoveryReasonCodeSchema>;
      explanation: string;
    }>
  >;
  newActions: Array<Readonly<{ template: string; targetCandidateId: string; explanation: string }>>;
}>;

export type PreventionRuleProposal = Readonly<{
  schemaVersion: typeof PREVENTION_RULE_PROPOSAL_SCHEMA_VERSION;
  type: "calendar_company_region_ambiguity";
  company: "Acme";
  minimumMatches: 2;
  disambiguationField: "region";
  protectedActions: ["calendar.move", "mail.notify"];
  requiredAction: "ask_for_confirmation";
  scope: "demo_workspace";
  sourceTaskId: string;
  displayText: string;
  rationale: string;
}>;

export function createInitialReasoningSchemaContract(input: InitialModelInput): ModelOnlySchemaContract<InitialReasoningProposal> {
  const universe = InitialModelInputSchema.parse(input);
  const candidateId = closedValueSchema(universe.allowedCandidateIds, "Candidate ID");
  const actionKey = closedValueSchema(universe.allowedActionKeys, "Action key");
  const outputSchema: z.ZodType<InitialReasoningProposal> = z
    .object({
      schemaVersion: z.literal(INITIAL_REASONING_SCHEMA_VERSION),
      selectedCandidateId: candidateId,
      assumption: z
        .object({
          assumptionId: AssumptionIdSchema,
          statement: z.string().min(1).max(500),
          resolvedCandidateId: candidateId,
          evidence: z.array(z.string().min(1).max(500)).min(1).max(10),
          confidence: z.number().min(0).max(1),
        })
        .strict(),
      dependencyEdges: z
        .array(
          z
            .object({
              actionKey,
              assumptionIds: z.array(AssumptionIdSchema).max(1),
            })
            .strict(),
        )
        .min(1)
        .max(universe.allowedActionKeys.length),
      accountBrief: z
        .object({
          title: z.string().min(1).max(200),
          content: z.string().min(1).max(5000),
          sourceId: z.literal("acme_parent_account_notes"),
        })
        .strict(),
    })
    .strict();

  const candidateIdJson = jsonString({ enum: universe.allowedCandidateIds });
  const assumptionJson = strictJsonObject({
    assumptionId: jsonString({ enum: ["assumption_acme_region"] }),
    statement: jsonString({ minLength: 1, maxLength: 500 }),
    resolvedCandidateId: candidateIdJson,
    evidence: jsonArray(jsonString({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 10 }),
    confidence: { type: "number", minimum: 0, maximum: 1 },
  });
  const dependencyEdgeJson = strictJsonObject({
    actionKey: jsonString({ enum: universe.allowedActionKeys }),
    assumptionIds: jsonArray(jsonString({ enum: ["assumption_acme_region"] }), { minItems: 0, maxItems: 1 }),
  });
  const accountBriefJson = strictJsonObject({
    title: jsonString({ minLength: 1, maxLength: 200 }),
    content: jsonString({ minLength: 1, maxLength: 5000 }),
    sourceId: jsonString({ enum: ["acme_parent_account_notes"] }),
  });

  return {
    schemaName: MODEL_OUTPUT_SCHEMA_NAMES.initial,
    schemaVersion: INITIAL_REASONING_SCHEMA_VERSION,
    outputSchema,
    jsonSchema: strictJsonObject({
      schemaVersion: jsonString({ enum: [INITIAL_REASONING_SCHEMA_VERSION] }),
      selectedCandidateId: candidateIdJson,
      assumption: assumptionJson,
      dependencyEdges: jsonArray(dependencyEdgeJson, { minItems: 1, maxItems: universe.allowedActionKeys.length }),
      accountBrief: accountBriefJson,
    }),
  };
}

export function createRecoveryProposalSchemaContract(input: RecoveryModelInput): ModelOnlySchemaContract<RecoveryProposal> {
  const universe = RecoveryModelInputSchema.parse(input);
  const candidateId = closedValueSchema(universe.allowedCandidateIds, "Candidate ID");
  const executedActionId = closedValueSchema(universe.completedActionIds, "Executed action ID");
  const outcome = z.enum(universe.allowedOutcomes);
  const template = closedValueSchema(universe.allowedNewActionTemplates, "New-action template");
  const outputSchema: z.ZodType<RecoveryProposal> = z
    .object({
      schemaVersion: z.literal(RECOVERY_PROPOSAL_SCHEMA_VERSION),
      correctedAssumption: z
        .object({
          assumptionId: AssumptionIdSchema,
          fromCandidateId: candidateId,
          toCandidateId: candidateId,
        })
        .strict(),
      decisions: z
        .array(
          z
            .object({
              executedActionId,
              outcome,
              reasonCode: RecoveryReasonCodeSchema,
              explanation: z.string().min(1).max(500),
            })
            .strict(),
        )
        .min(1)
        .max(universe.completedActionIds.length),
      newActions: z
        .array(
          z
            .object({
              template,
              targetCandidateId: candidateId,
              explanation: z.string().min(1).max(500),
            })
            .strict(),
        )
        .min(1)
        .max(universe.allowedNewActionTemplates.length),
    })
    .strict();

  const candidateIdJson = jsonString({ enum: universe.allowedCandidateIds });
  const correctedAssumptionJson = strictJsonObject({
    assumptionId: jsonString({ enum: ["assumption_acme_region"] }),
    fromCandidateId: candidateIdJson,
    toCandidateId: candidateIdJson,
  });
  const decisionJson = strictJsonObject({
    executedActionId: jsonString({ enum: universe.completedActionIds }),
    outcome: jsonString({ enum: universe.allowedOutcomes }),
    reasonCode: jsonString({ enum: RecoveryReasonCodeSchema.options }),
    explanation: jsonString({ minLength: 1, maxLength: 500 }),
  });
  const newActionJson = strictJsonObject({
    template: jsonString({ enum: universe.allowedNewActionTemplates }),
    targetCandidateId: candidateIdJson,
    explanation: jsonString({ minLength: 1, maxLength: 500 }),
  });

  return {
    schemaName: MODEL_OUTPUT_SCHEMA_NAMES.recovery,
    schemaVersion: RECOVERY_PROPOSAL_SCHEMA_VERSION,
    outputSchema,
    jsonSchema: strictJsonObject({
      schemaVersion: jsonString({ enum: [RECOVERY_PROPOSAL_SCHEMA_VERSION] }),
      correctedAssumption: correctedAssumptionJson,
      decisions: jsonArray(decisionJson, { minItems: 1, maxItems: universe.completedActionIds.length }),
      newActions: jsonArray(newActionJson, { minItems: 1, maxItems: universe.allowedNewActionTemplates.length }),
    }),
  };
}

export function createPreventionRuleProposalSchemaContract(
  input: PreventionRuleModelInput,
): ModelOnlySchemaContract<PreventionRuleProposal> {
  const universe = PreventionRuleModelInputSchema.parse(input);
  const outputSchema: z.ZodType<PreventionRuleProposal> = z
    .object({
      schemaVersion: z.literal(PREVENTION_RULE_PROPOSAL_SCHEMA_VERSION),
      type: z.literal(universe.ruleType),
      company: z.literal("Acme"),
      minimumMatches: z.literal(2),
      disambiguationField: z.literal("region"),
      protectedActions: z.tuple([z.literal("calendar.move"), z.literal("mail.notify")]),
      requiredAction: z.literal(universe.allowedAction),
      scope: z.literal("demo_workspace"),
      sourceTaskId: z.literal(universe.sourceTaskId),
      displayText: z.string().min(1).max(500),
      rationale: z.string().min(1).max(1000),
    })
    .strict();

  return {
    schemaName: MODEL_OUTPUT_SCHEMA_NAMES.preventionRule,
    schemaVersion: PREVENTION_RULE_PROPOSAL_SCHEMA_VERSION,
    outputSchema,
    jsonSchema: strictJsonObject({
      schemaVersion: jsonString({ enum: [PREVENTION_RULE_PROPOSAL_SCHEMA_VERSION] }),
      type: jsonString({ enum: [universe.ruleType] }),
      company: jsonString({ enum: ["Acme"] }),
      minimumMatches: { type: "integer", enum: [2] },
      disambiguationField: jsonString({ enum: ["region"] }),
      protectedActions: jsonArray(jsonString({ enum: ["calendar.move", "mail.notify"] }), { minItems: 2, maxItems: 2 }),
      requiredAction: jsonString({ enum: [universe.allowedAction] }),
      scope: jsonString({ enum: ["demo_workspace"] }),
      sourceTaskId: jsonString({ enum: [universe.sourceTaskId] }),
      displayText: jsonString({ minLength: 1, maxLength: 500 }),
      rationale: jsonString({ minLength: 1, maxLength: 1000 }),
    }),
  };
}
