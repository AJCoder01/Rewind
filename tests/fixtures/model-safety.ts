import type {
  InitialModelInput,
  PreventionRuleModelInput,
  RecoveryModelInput,
} from "@/lib/contracts/provider-ports";
import type {
  InitialReasoningProposal,
  PreventionRuleProposal,
  RecoveryProposal,
} from "@/lib/ai/model-schemas";
import type {
  InitialProposalValidationContext,
  PreventionRuleValidationContext,
  RecoveryProposalValidationContext,
} from "@/lib/ai/model-safety";

export const MODEL_SAFETY_FIXTURE_VERSION = "model-safety.v1" as const;

export const MODEL_SAFETY_INITIAL_INPUT = {
  request: "Move the synthetic Acme renewal and prepare the approved brief.",
  candidateEvidence: ["UK is nearest on the configured date.", "US remains a visible alternative."],
  allowedCandidateIds: ["cal_event_acme_uk", "cal_event_acme_us"],
  allowedActionKeys: ["initial.artifact.account_brief", "initial.calendar.move", "initial.mail.notify"],
} satisfies InitialModelInput;

export const MODEL_SAFETY_INITIAL_PROPOSAL = {
  schemaVersion: "initial-reasoning.v1",
  selectedCandidateId: "cal_event_acme_uk",
  assumption: {
    assumptionId: "assumption_acme_region",
    statement: "Acme refers to the nearest controlled candidate.",
    resolvedCandidateId: "cal_event_acme_uk",
    evidence: ["The controlled ranking facts identify the UK candidate first."],
    confidence: 0.82,
  },
  dependencyEdges: [
    { actionKey: "initial.artifact.account_brief", assumptionIds: [] },
    { actionKey: "initial.calendar.move", assumptionIds: ["assumption_acme_region"] },
    { actionKey: "initial.mail.notify", assumptionIds: ["assumption_acme_region"] },
  ],
  accountBrief: {
    title: "Acme parent-account renewal risk brief",
    content: "Synthetic parent-account risks only.",
    sourceId: "acme_parent_account_notes",
  },
} satisfies InitialReasoningProposal;

export const MODEL_SAFETY_INITIAL_CONTEXT = {
  expectedSelectedCandidateId: "cal_event_acme_uk",
  expectedAccountBriefTitle: "Acme parent-account renewal risk brief",
} satisfies InitialProposalValidationContext;

export const MODEL_SAFETY_RECOVERY_INPUT = {
  lateContext: "Sales explicitly confirmed that the intended target is Acme US.",
  allowedCandidateIds: ["cal_event_acme_uk", "cal_event_acme_us"],
  completedActionIds: ["actexec_initial_artifact", "actexec_initial_calendar", "actexec_initial_mail"],
  allowedOutcomes: ["restore", "correct", "preserve"],
  allowedNewActionTemplates: ["calendar.apply_to_correct_entity", "mail.notify_correct_attendees"],
  allowedActionKeys: [
    "recovery.calendar.restore_uk",
    "recovery.calendar.move_us",
    "recovery.mail.correct_uk",
    "recovery.mail.notify_us",
  ],
} satisfies RecoveryModelInput;

export const MODEL_SAFETY_RECOVERY_PROPOSAL = {
  schemaVersion: "recovery-proposal.v1",
  correctedAssumption: {
    assumptionId: "assumption_acme_region",
    fromCandidateId: "cal_event_acme_uk",
    toCandidateId: "cal_event_acme_us",
  },
  decisions: [
    {
      executedActionId: "actexec_initial_artifact",
      outcome: "preserve",
      reasonCode: "recorded_dependency_unchanged",
      explanation: "The brief has independent parent-account provenance.",
    },
    {
      executedActionId: "actexec_initial_calendar",
      outcome: "restore",
      reasonCode: "entity_dependency_invalidated",
      explanation: "The Calendar move depended on the corrected entity assumption.",
    },
    {
      executedActionId: "actexec_initial_mail",
      outcome: "correct",
      reasonCode: "irreversible_effect_requires_correction",
      explanation: "The original notification remains a sent effect.",
    },
  ],
  newActions: [
    {
      template: "calendar.apply_to_correct_entity",
      targetCandidateId: "cal_event_acme_us",
      explanation: "Apply the fixed meeting change to the explicit corrected candidate.",
    },
    {
      template: "mail.notify_correct_attendees",
      targetCandidateId: "cal_event_acme_us",
      explanation: "Notify the corrected candidate through the registered template.",
    },
  ],
} satisfies RecoveryProposal;

export const MODEL_SAFETY_RECOVERY_CONTEXT = {
  initialSelectedCandidateId: "cal_event_acme_uk",
  explicitCorrectedCandidateId: "cal_event_acme_us",
  completedActions: [
    {
      executedActionId: "actexec_initial_artifact",
      actionKey: "initial.artifact.account_brief",
      status: "succeeded",
      dependsOnAssumptionIds: [],
    },
    {
      executedActionId: "actexec_initial_calendar",
      actionKey: "initial.calendar.move",
      status: "succeeded",
      dependsOnAssumptionIds: ["assumption_acme_region"],
    },
    {
      executedActionId: "actexec_initial_mail",
      actionKey: "initial.mail.notify",
      status: "succeeded",
      dependsOnAssumptionIds: ["assumption_acme_region"],
    },
  ],
  recipientSafety: {
    exactRecipientsByCandidate: {
      cal_event_acme_uk: ["uk-ops@example.test"],
      cal_event_acme_us: ["us-ops@example.test"],
    },
    teamAllowlist: ["uk-ops@example.test", "us-ops@example.test"],
  },
} satisfies RecoveryProposalValidationContext;

export const MODEL_SAFETY_PREVENTION_INPUT = {
  sourceTaskId: "task_source_s042",
  candidateIds: ["cal_event_acme_uk", "cal_event_acme_us"],
  ruleType: "calendar_company_region_ambiguity",
  allowedAction: "ask_for_confirmation",
} satisfies PreventionRuleModelInput;

export const MODEL_SAFETY_PREVENTION_PROPOSAL = {
  schemaVersion: "prevention-rule-proposal.v1",
  type: "calendar_company_region_ambiguity",
  company: "Acme",
  minimumMatches: 2,
  disambiguationField: "region",
  protectedActions: ["calendar.move", "mail.notify"],
  requiredAction: "ask_for_confirmation",
  scope: "demo_workspace",
  sourceTaskId: "task_source_s042",
  displayText: "Confirm the Acme region before Calendar or mail actions.",
  rationale: "Two controlled regional candidates are available for the same renewal request.",
} satisfies PreventionRuleProposal;

export const MODEL_SAFETY_PREVENTION_CONTEXT = {
  expectedSourceTaskId: "task_source_s042",
} satisfies PreventionRuleValidationContext;
