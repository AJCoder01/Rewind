import { describe, expect, it } from "vitest";
import {
  createInitialReasoningSchemaContract,
  createPreventionRuleProposalSchemaContract,
  createRecoveryProposalSchemaContract,
} from "@/lib/ai/model-schemas";
import { OpenAIResponsesRequestSchema } from "@/lib/ai/openai-responses";
import type { InitialModelInput, PreventionRuleModelInput, RecoveryModelInput } from "@/lib/contracts/provider-ports";

const initialInput = {
  request: "Move the synthetic Acme renewal and prepare the approved brief.",
  candidateEvidence: ["UK is nearest.", "US remains an alternative."],
  allowedCandidateIds: ["cal_event_acme_uk", "cal_event_acme_us"],
  allowedActionKeys: ["initial.artifact.account_brief", "initial.calendar.move", "initial.mail.notify"],
} satisfies InitialModelInput;

const recoveryInput = {
  lateContext: "Sales clarified that the intended target is Acme US.",
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

const preventionInput = {
  sourceTaskId: "task_source_s041",
  candidateIds: ["cal_event_acme_uk", "cal_event_acme_us"],
  ruleType: "calendar_company_region_ambiguity",
  allowedAction: "ask_for_confirmation",
} satisfies PreventionRuleModelInput;

const initialProposal = {
  schemaVersion: "initial-reasoning.v1",
  selectedCandidateId: "cal_event_acme_uk",
  assumption: {
    assumptionId: "assumption_acme_region",
    statement: "Acme refers to Acme UK.",
    resolvedCandidateId: "cal_event_acme_uk",
    evidence: ["UK is nearest."],
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
};

const recoveryProposal = {
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
      explanation: "The brief is independent of region.",
    },
    {
      executedActionId: "actexec_initial_calendar",
      outcome: "restore",
      reasonCode: "entity_dependency_invalidated",
      explanation: "The Calendar target depended on the invalidated assumption.",
    },
    {
      executedActionId: "actexec_initial_mail",
      outcome: "correct",
      reasonCode: "irreversible_effect_requires_correction",
      explanation: "The sent message remains and needs a correction.",
    },
  ],
  newActions: [
    {
      template: "calendar.apply_to_correct_entity",
      targetCandidateId: "cal_event_acme_us",
      explanation: "Apply the approved meeting change to the corrected target.",
    },
    {
      template: "mail.notify_correct_attendees",
      targetCandidateId: "cal_event_acme_us",
      explanation: "Notify the corrected target through the registered template.",
    },
  ],
};

const preventionProposal = {
  schemaVersion: "prevention-rule-proposal.v1",
  type: "calendar_company_region_ambiguity",
  company: "Acme",
  minimumMatches: 2,
  disambiguationField: "region",
  protectedActions: ["calendar.move", "mail.notify"],
  requiredAction: "ask_for_confirmation",
  scope: "demo_workspace",
  sourceTaskId: "task_source_s041",
  displayText: "Confirm the Acme region before Calendar or mail actions.",
  rationale: "Two controlled regional candidates matched the corrected request.",
};

function assertEveryObjectIsStrict(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (record.type === "object") {
    expect(record.additionalProperties).toBe(false);
    const properties = record.properties as Record<string, unknown>;
    expect(record.required).toEqual(Object.keys(properties));
  }
  for (const value of Object.values(record)) assertEveryObjectIsStrict(value);
}

describe("S041 model-only proposal schemas", () => {
  it("accepts the three versioned closed proposal shapes", () => {
    expect(createInitialReasoningSchemaContract(initialInput).outputSchema.parse(initialProposal)).toEqual(initialProposal);
    expect(createRecoveryProposalSchemaContract(recoveryInput).outputSchema.parse(recoveryProposal)).toEqual(recoveryProposal);
    expect(createPreventionRuleProposalSchemaContract(preventionInput).outputSchema.parse(preventionProposal)).toEqual(preventionProposal);
  });

  it("rejects unknown candidate, action, executed-action, and template IDs", () => {
    const initial = createInitialReasoningSchemaContract(initialInput).outputSchema;
    expect(initial.safeParse({ ...initialProposal, selectedCandidateId: "cal_event_attacker" }).success).toBe(false);
    expect(
      initial.safeParse({
        ...initialProposal,
        dependencyEdges: [{ ...initialProposal.dependencyEdges[0], actionKey: "initial.shell.execute" }],
      }).success,
    ).toBe(false);

    const recovery = createRecoveryProposalSchemaContract(recoveryInput).outputSchema;
    expect(
      recovery.safeParse({
        ...recoveryProposal,
        decisions: [{ ...recoveryProposal.decisions[0], executedActionId: "actexec_unknown" }],
      }).success,
    ).toBe(false);
    expect(
      recovery.safeParse({
        ...recoveryProposal,
        newActions: [{ ...recoveryProposal.newActions[0], template: "mail.send_arbitrary" }],
      }).success,
    ).toBe(false);
  });

  it("rejects extra fields and executable provider data at every proposal boundary", () => {
    expect(createInitialReasoningSchemaContract(initialInput).outputSchema.safeParse({ ...initialProposal, calendarId: "provider-calendar" }).success).toBe(false);
    expect(
      createRecoveryProposalSchemaContract(recoveryInput).outputSchema.safeParse({
        ...recoveryProposal,
        newActions: [{ ...recoveryProposal.newActions[0], recipients: ["outside@example.test"] }],
      }).success,
    ).toBe(false);
    expect(
      createPreventionRuleProposalSchemaContract(preventionInput).outputSchema.safeParse({ ...preventionProposal, predicate: "arbitrary" }).success,
    ).toBe(false);
  });

  it("emits strict Responses-compatible JSON Schemas with the supplied enums", () => {
    const initial = createInitialReasoningSchemaContract(initialInput);
    const recovery = createRecoveryProposalSchemaContract(recoveryInput);
    const prevention = createPreventionRuleProposalSchemaContract(preventionInput);
    for (const contract of [initial, recovery, prevention]) assertEveryObjectIsStrict(contract.jsonSchema);

    expect(JSON.stringify(initial.jsonSchema)).toContain('"cal_event_acme_uk"');
    expect(JSON.stringify(recovery.jsonSchema)).toContain('"calendar.apply_to_correct_entity"');
    expect(JSON.stringify(prevention.jsonSchema)).toContain('"ask_for_confirmation"');

    for (const contract of [initial, recovery, prevention]) {
      expect(
        OpenAIResponsesRequestSchema.safeParse({
          model: "fixture-model",
          input: "Synthetic prompt.",
          schemaName: contract.schemaName,
          jsonSchema: contract.jsonSchema,
          promptVersion: "fixture.prompt.v1",
          schemaVersion: contract.schemaVersion,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects duplicate or incomplete supplied universes before schema construction", () => {
    expect(() => createInitialReasoningSchemaContract({ ...initialInput, allowedCandidateIds: ["cal_event_acme_uk", "cal_event_acme_uk"] })).toThrow();
    expect(() =>
      createRecoveryProposalSchemaContract({
        ...recoveryInput,
        completedActionIds: ["actexec_initial_mail", "actexec_initial_mail"],
      }),
    ).toThrow();
  });

  it("keeps provider targets, recipients, message bodies, headers, times, and code out of model schemas", () => {
    const schemas = [
      createInitialReasoningSchemaContract(initialInput).jsonSchema,
      createRecoveryProposalSchemaContract(recoveryInput).jsonSchema,
      createPreventionRuleProposalSchemaContract(preventionInput).jsonSchema,
    ];
    const serialized = JSON.stringify(schemas);
    for (const forbidden of ["providerEventId", "calendarId", "recipients", "bodyText", "headers", "sendUpdates", "expectedEtag", "start", "end", "code"]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`);
    }
  });
});
