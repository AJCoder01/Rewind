import { z } from "zod";

const Rfc3339 = z.string().datetime({ offset: true });
const Id = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "IDs must be opaque URL-safe identifiers");
const Version = z.number().int().min(1).max(1000);
export const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const OpaqueIdSchema = Id;
export const Rfc3339Schema = Rfc3339;
export const VersionSchema = Version;

export const TaskStatusSchema = z.enum([
  "analyzing",
  "clarification_required",
  "preview_ready",
  "executing",
  "completed",
  "correction_pending",
  "recovery_ready",
  "recovering",
  "recovered",
  "attention_required",
  "cancelled",
  "failed",
]);

export const ActionStatusSchema = z.enum([
  "planned",
  "in_progress",
  "succeeded",
  "retryable_failed",
  "delivery_uncertain",
  "conflict",
  "permanently_failed",
]);

export const ErrorCodeSchema = z.enum([
  "unauthorized",
  "forbidden",
  "invalid_request",
  "unsupported_request",
  "idempotency_conflict",
  "scenario_busy",
  "task_not_found",
  "invalid_task_state",
  "plan_not_found",
  "plan_digest_mismatch",
  "plan_stale",
  "approval_required",
  "clarification_required",
  "candidate_set_invalid",
  "model_output_invalid",
  "unknown_entity",
  "unknown_action",
  "unknown_template",
  "recipient_not_allowed",
  "provider_conflict",
  "provider_unavailable",
  "delivery_uncertain",
  "action_not_retryable",
  "reset_conflict",
  "internal_error",
]);

export const InitialPlanPointerSchema = z
  .object({
    planId: Id,
    kind: z.literal("initial"),
    version: Version,
    digest: Sha256DigestSchema,
  })
  .strict();

export const RecoveryPlanPointerSchema = z
  .object({
    planId: Id,
    kind: z.literal("recovery"),
    version: Version,
    digest: Sha256DigestSchema,
  })
  .strict();

export const ResetPlanPointerSchema = z
  .object({
    planId: Id,
    kind: z.literal("reset"),
    version: Version,
    digest: Sha256DigestSchema,
  })
  .strict();

export const PlanPointerSchema = z.union([InitialPlanPointerSchema, RecoveryPlanPointerSchema, ResetPlanPointerSchema]);

export const CandidateSchema = z
  .object({
    candidateId: Id,
    label: z.string().min(1).max(100),
  })
  .strict();

export const ZonedDateTimeSchema = z
  .object({
    instant: Rfc3339,
    timeZone: z.string().min(1).max(100),
  })
  .strict();

const AssumptionSchema = z
  .object({
    assumptionId: z.literal("assumption_acme_region"),
    statement: z.string().min(1).max(500),
    resolvedCandidateId: Id,
    evidence: z.array(z.string().min(1).max(500)).min(1).max(10),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const CalendarPreconditionsSchema = z
  .object({
    expectedEtag: z.string().min(1).max(200),
    expectedStart: ZonedDateTimeSchema,
    expectedEnd: ZonedDateTimeSchema,
    organizerDigest: Sha256DigestSchema,
    attendeeSetDigest: Sha256DigestSchema,
    eventType: z.literal("default"),
    recurringEventId: z.null(),
    ownedByConnectedAccount: z.literal(true),
    privateTags: z
      .object({ rewind_demo: z.literal("acme-renewal"), region: z.enum(["UK", "US"]) })
      .strict(),
  })
  .strict();

const CalendarTargetSchema = z.object({ calendarId: Id, providerEventId: Id }).strict();

const CalendarDesiredSchema = z
  .object({
    start: ZonedDateTimeSchema,
    end: ZonedDateTimeSchema,
    durationMinutes: z.literal(30),
    sendUpdates: z.literal("none"),
  })
  .strict();

const CalendarMoveActionSchema = z
  .object({
    actionKey: z.literal("initial.calendar.move"),
    type: z.literal("calendar.move"),
    dependsOnAssumptionIds: z.array(z.literal("assumption_acme_region")).length(1),
    externalEffect: z.literal(true),
    target: CalendarTargetSchema,
    preconditions: CalendarPreconditionsSchema,
    desired: CalendarDesiredSchema,
  })
  .strict();

const ApprovedMailSchema = z
  .object({
    senderGoogleSub: Id,
    to: z.array(z.string().email()).min(1).max(20),
    subject: z.string().min(1).max(200),
    bodyText: z.string().min(1).max(5000),
    bodyHash: Sha256DigestSchema,
    runId: Id,
  })
  .strict();

const MailNotificationActionSchema = z
  .object({
    actionKey: z.literal("initial.mail.notify"),
    type: z.literal("mail.notify"),
    dependsOnAssumptionIds: z.array(z.literal("assumption_acme_region")).length(1),
    externalEffect: z.literal(true),
    desired: ApprovedMailSchema,
    requiresSucceededActionKey: z.literal("initial.calendar.move"),
  })
  .strict();

const AccountBriefActionSchema = z
  .object({
    actionKey: z.literal("initial.artifact.account_brief"),
    type: z.literal("artifact.account_brief"),
    dependsOnAssumptionIds: z.array(z.never()).length(0),
    externalEffect: z.literal(false),
    desired: z
      .object({
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(5000),
        contentHash: Sha256DigestSchema,
        provenance: z
          .object({
            sourceId: z.literal("acme_parent_account_notes"),
            sourceDigest: Sha256DigestSchema,
            excludedDimensions: z
              .tuple([
                z.literal("calendar_event"),
                z.literal("region"),
                z.literal("attendees"),
                z.literal("meeting_time"),
              ])
              .readonly(),
            validatorVersion: z.string().min(1).max(100),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const InitialActionSchema = z.discriminatedUnion("type", [
  CalendarMoveActionSchema,
  MailNotificationActionSchema,
  AccountBriefActionSchema,
]);

export const InitialPlanViewSchema = z
  .object({
    pointer: InitialPlanPointerSchema,
    selectedCandidate: CandidateSchema,
    alternatives: z.array(CandidateSchema).length(1),
    assumptions: z.array(AssumptionSchema).length(1),
    actions: z.tuple([AccountBriefActionSchema, CalendarMoveActionSchema, MailNotificationActionSchema]),
  })
  .strict();

export const CalendarCandidateSchema = z
  .object({
    candidateId: Id,
    providerEventId: Id,
    title: z.string().min(1).max(200),
    company: z.literal("Acme"),
    region: z.enum(["UK", "US"]),
    start: ZonedDateTimeSchema,
    end: ZonedDateTimeSchema,
    etag: z.string().min(1).max(200),
    attendeeSetDigest: Sha256DigestSchema,
    rankingEvidence: z.array(z.string().min(1).max(500)).min(1).max(10),
  })
  .strict();

export const ModelMetadataSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("openai"),
      model: z.string().min(1).max(200),
      promptVersion: z.string().min(1).max(100),
      schemaVersion: z.string().min(1).max(100),
      reasoningEffort: z.string().min(1).max(100),
      responseId: z.string().min(1).max(200).optional(),
      source: z.enum(["model", "fallback"]),
    })
    .strict(),
  z
    .object({
      provider: z.literal("fixture"),
      model: z.string().min(1).max(200),
      promptVersion: z.string().min(1).max(100),
      schemaVersion: z.string().min(1).max(100),
      reasoningEffort: z.literal("none"),
      responseId: z.string().min(1).max(200).optional(),
      source: z.literal("fixture"),
    })
    .strict(),
]);

export const InitialPlanPayloadCoreSchema = z
  .object({
    schemaVersion: z.literal("initial-plan.v1"),
    taskId: Id,
    planId: Id,
    version: Version,
    request: z.string().min(1).max(2000),
    candidateSet: z.tuple([CalendarCandidateSchema, CalendarCandidateSchema]),
    selectedCandidateId: Id,
    alternativeCandidateIds: z.array(Id).length(1),
    assumptions: z.array(AssumptionSchema).length(1),
    actions: z.tuple([AccountBriefActionSchema, CalendarMoveActionSchema, MailNotificationActionSchema]),
    accountBriefContentHash: Sha256DigestSchema,
    executionOrder: z.tuple([
      z.literal("initial.artifact.account_brief"),
      z.literal("initial.calendar.move"),
      z.literal("initial.mail.notify"),
    ]),
    modelMetadata: ModelMetadataSchema,
  })
  .strict();

export const InitialPlanPayloadSchema = InitialPlanPayloadCoreSchema.extend({
  digest: Sha256DigestSchema,
})
  .strict()
  .superRefine((value, context) => {
    const [artifact, calendar] = value.actions;
    const candidateIds = new Set(value.candidateSet.map((candidate) => candidate.candidateId));
    const candidateRegions = new Set(value.candidateSet.map((candidate) => candidate.region));
    const selected = value.candidateSet.find((candidate) => candidate.candidateId === value.selectedCandidateId);
    const alternativeId = value.alternativeCandidateIds[0];
    if (
      candidateIds.size !== 2 ||
      candidateRegions.size !== 2 ||
      !candidateRegions.has("UK") ||
      !candidateRegions.has("US") ||
      !selected ||
      !candidateIds.has(alternativeId) ||
      alternativeId === value.selectedCandidateId
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedCandidateId"], message: "Selected and alternative candidates must identify the closed two-candidate universe" });
      return;
    }
    if (selected.region !== "UK") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedCandidateId"], message: "The controlled initial plan must select the UK candidate" });
    }
    if (value.assumptions[0].resolvedCandidateId !== selected.candidateId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["assumptions", 0, "resolvedCandidateId"], message: "The assumption must resolve to the selected candidate" });
    }
    if (
      calendar.target.providerEventId !== selected.providerEventId ||
      calendar.preconditions.expectedEtag !== selected.etag ||
      calendar.preconditions.attendeeSetDigest !== selected.attendeeSetDigest ||
      calendar.preconditions.expectedStart.instant !== selected.start.instant ||
      calendar.preconditions.expectedStart.timeZone !== selected.start.timeZone ||
      calendar.preconditions.expectedEnd.instant !== selected.end.instant ||
      calendar.preconditions.expectedEnd.timeZone !== selected.end.timeZone ||
      calendar.preconditions.privateTags.region !== selected.region
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", 1], message: "Calendar target and preconditions must match the selected candidate" });
    }
    if (artifact.desired.contentHash !== value.accountBriefContentHash) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["accountBriefContentHash"], message: "Account brief hashes must match the exact approved content" });
    }
  });

const RecoveryCorrectedAssumptionSchema = z
  .object({
    assumptionId: z.literal("assumption_acme_region"),
    fromCandidateId: Id,
    toCandidateId: Id,
  })
  .strict()
  .refine((value) => value.fromCandidateId !== value.toCandidateId, "Recovery target must differ from the invalidated candidate");

const RecoveryDecisionSchema = z
  .object({
    executedActionId: Id,
    outcome: z.enum(["restore", "correct", "preserve"]),
    explanation: z.string().min(1).max(500),
  })
  .strict();

const RecoveryCalendarRestoreActionSchema = z
  .object({
    actionKey: z.literal("recovery.calendar.restore_uk"),
    type: z.literal("calendar.restore"),
    dependsOnAssumptionIds: z.array(z.literal("assumption_acme_region")).length(1),
    externalEffect: z.literal(true),
    target: CalendarTargetSchema,
    preconditions: CalendarPreconditionsSchema,
    desired: CalendarDesiredSchema,
  })
  .strict();

const RecoveryCalendarMoveActionSchema = z
  .object({
    actionKey: z.literal("recovery.calendar.move_us"),
    type: z.literal("calendar.move"),
    dependsOnAssumptionIds: z.array(z.literal("assumption_acme_region")).length(1),
    externalEffect: z.literal(true),
    target: CalendarTargetSchema,
    preconditions: CalendarPreconditionsSchema,
    desired: CalendarDesiredSchema,
  })
  .strict();

const RecoveryMailCorrectionActionSchema = z
  .object({
    actionKey: z.literal("recovery.mail.correct_uk"),
    type: z.literal("mail.correct"),
    dependsOnAssumptionIds: z.array(z.literal("assumption_acme_region")).length(1),
    externalEffect: z.literal(true),
    desired: ApprovedMailSchema,
    correctsActionExecutionId: Id,
    requiresSucceededActionKey: z.literal("recovery.calendar.restore_uk"),
  })
  .strict();

const RecoveryMailNotificationActionSchema = z
  .object({
    actionKey: z.literal("recovery.mail.notify_us"),
    type: z.literal("mail.notify"),
    dependsOnAssumptionIds: z.array(z.literal("assumption_acme_region")).length(1),
    externalEffect: z.literal(true),
    desired: ApprovedMailSchema,
    requiresSucceededActionKey: z.literal("recovery.calendar.move_us"),
  })
  .strict();

export const RecoveryPlanViewSchema = z
  .object({
    pointer: RecoveryPlanPointerSchema,
    correctedAssumption: RecoveryCorrectedAssumptionSchema,
    decisions: z.array(RecoveryDecisionSchema).length(3),
    actions: z.tuple([
      RecoveryCalendarRestoreActionSchema,
      RecoveryCalendarMoveActionSchema,
      RecoveryMailCorrectionActionSchema,
      RecoveryMailNotificationActionSchema,
    ]),
  })
  .strict();

const RecoveryPreconditionsSchema = z
  .object({
    ukCurrentMustEqualInitialAfterState: CalendarPreconditionsSchema,
    usCurrentMustEqualRecoveryPreview: CalendarPreconditionsSchema,
    originalUkMailReceiptId: Id,
    exactOriginalUkRecipientSetDigest: Sha256DigestSchema,
    exactUsRecipientSetDigest: Sha256DigestSchema,
    allCalendarPreflightsBeforeFirstWrite: z.literal(true),
  })
  .strict();

export const RecoveryPlanPayloadCoreSchema = z
  .object({
    schemaVersion: z.literal("recovery-plan.v1"),
    taskId: Id,
    planId: Id,
    version: Version,
    correctedAssumption: RecoveryCorrectedAssumptionSchema,
    decisions: z.array(RecoveryDecisionSchema).length(3),
    actions: z.tuple([
      RecoveryCalendarRestoreActionSchema,
      RecoveryCalendarMoveActionSchema,
      RecoveryMailCorrectionActionSchema,
      RecoveryMailNotificationActionSchema,
    ]),
    preservedActionIds: z.tuple([Id]),
    executionOrder: z.tuple([
      z.literal("recovery.calendar.restore_uk"),
      z.literal("recovery.calendar.move_us"),
      z.literal("recovery.mail.correct_uk"),
      z.literal("recovery.mail.notify_us"),
    ]),
    preconditions: RecoveryPreconditionsSchema,
    modelMetadata: ModelMetadataSchema,
  })
  .strict();

export const RecoveryPlanPayloadSchema = RecoveryPlanPayloadCoreSchema.extend({ digest: Sha256DigestSchema })
  .strict()
  .superRefine((value, context) => {
    const actionKeys = value.actions.map((action) => action.actionKey);
    if (JSON.stringify(actionKeys) !== JSON.stringify(value.executionOrder)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["executionOrder"], message: "Recovery action order must match the immutable execution order" });
    }
    if (value.actions[1].target.providerEventId === value.actions[0].target.providerEventId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["actions"], message: "Recovery restore and corrected move must target different controlled events" });
    }
  });

export const TimelineItemSchema = z
  .object({
    eventId: Id,
    type: z.string().min(1).max(100),
    occurredAt: Rfc3339,
    label: z.string().min(1).max(300),
    status: z.union([TaskStatusSchema, ActionStatusSchema]).optional(),
  })
  .strict();

export const ClarificationSchema = z
  .object({
    question: z.string().min(1).max(500),
    candidates: z.array(CandidateSchema).length(2),
  })
  .strict();

export const AttentionReasonSchema = z
  .object({
    stage: z.enum(["initial", "recovery", "reset"]),
    kind: z.enum(["retryable_failure", "delivery_uncertain", "provider_conflict", "validation_failure", "permanent_failure", "partial_reset"]),
    actionKey: z.string().min(1).max(200).optional(),
  })
  .strict();

const PreventionRuleCoreSchema = z
  .object({
    schemaVersion: z.literal("prevention-rule.v1"),
    ruleId: Id,
    version: z.literal(1),
    type: z.literal("calendar_company_region_ambiguity"),
    company: z.literal("Acme"),
    minimumMatches: z.literal(2),
    disambiguationField: z.literal("region"),
    protectedActions: z.tuple([z.literal("calendar.move"), z.literal("mail.notify")]),
    requiredAction: z.literal("ask_for_confirmation"),
    scope: z.literal("demo_workspace"),
    sourceTaskId: Id,
    status: z.enum(["proposed", "active", "removed"]),
    displayText: z.string().min(1).max(500),
    rationale: z.string().min(1).max(1000),
  })
  .strict();

export const PreventionRuleSchema = PreventionRuleCoreSchema.extend({ digest: Sha256DigestSchema }).strict();
export const PreventionRuleCorePayloadSchema = PreventionRuleCoreSchema;

export const CalendarSemanticBaselineSchema = z
  .object({
    calendarId: Id,
    providerEventId: Id,
    start: ZonedDateTimeSchema,
    end: ZonedDateTimeSchema,
    durationMinutes: z.literal(30),
    organizerDigest: Sha256DigestSchema,
    attendeeSetDigest: Sha256DigestSchema,
    eventType: z.literal("default"),
    recurringEventId: z.null(),
    privateTags: z
      .object({ rewind_demo: z.literal("acme-renewal"), region: z.enum(["UK", "US"]) })
      .strict(),
  })
  .strict();

export const ResetTargetSchema = z
  .object({
    candidateId: z.enum(["cal_event_acme_uk", "cal_event_acme_us"]),
    semanticBaseline: CalendarSemanticBaselineSchema,
    approvedCurrentEtag: z.string().min(1).max(200),
    approvedCurrentStart: ZonedDateTimeSchema,
    approvedCurrentEnd: ZonedDateTimeSchema,
    sendUpdates: z.literal("none"),
  })
  .strict();

const ResetPlanBaseSchema = z
  .object({
    schemaVersion: z.literal("reset-plan.v1"),
    resetPlanId: Id,
    runId: Id,
    worldPrId: Id,
    version: Version,
    targets: z.tuple([ResetTargetSchema, ResetTargetSchema]),
    executionOrder: z.tuple([z.literal("reset.calendar.uk"), z.literal("reset.calendar.us")]),
    sentMailRemains: z.literal(true),
  })
  .strict();

function validateResetPlan(value: z.infer<typeof ResetPlanBaseSchema>, context: z.RefinementCtx): void {
    const ids = value.targets.map((target) => target.candidateId);
    if (new Set(ids).size !== 2 || !ids.includes("cal_event_acme_uk") || !ids.includes("cal_event_acme_us")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "Reset targets must contain UK and US exactly once" });
    }
    for (const target of value.targets) {
      const expectedRegion = target.candidateId.endsWith("_uk") ? "UK" : "US";
      if (target.semanticBaseline.privateTags.region !== expectedRegion) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "Reset target region must match its candidate" });
      }
    }
}

export const ResetPlanCoreSchema = ResetPlanBaseSchema.superRefine(validateResetPlan);

export const ResetPlanSchema = ResetPlanBaseSchema.extend({ digest: Sha256DigestSchema }).strict().superRefine(validateResetPlan);

export const ResetCompleteResponseSchema = z
  .object({
    status: z.literal("reset_complete"),
    resetPlanId: Id,
    archivedWorldPrId: Id,
    nextRunId: Id,
    calendarRestored: z.literal(true),
    sentMailDeleted: z.literal(false),
    requestId: Id,
  })
  .strict();

const ActivePlanViewSchema = z.union([InitialPlanViewSchema, RecoveryPlanViewSchema]);
const initialPlanStatuses = new Set(["preview_ready", "executing", "completed", "correction_pending"]);
const recoveryPlanStatuses = new Set(["recovery_ready", "recovering", "recovered"]);
const noPlanStatuses = new Set(["analyzing", "cancelled", "failed"]);

export const WorldPrViewSchema = z
  .object({
    worldPrId: Id,
    runId: Id.optional(),
    request: z.string().min(1).max(2000),
    status: TaskStatusSchema,
    activePlan: ActivePlanViewSchema.optional(),
    clarification: ClarificationSchema.optional(),
    attention: AttentionReasonSchema.optional(),
    ruleProposal: PreventionRuleSchema.optional(),
    timeline: z.array(TimelineItemSchema),
    createdAt: Rfc3339,
    updatedAt: Rfc3339,
  })
  .strict()
  .superRefine((value, context) => {
    const planKind = value.activePlan?.pointer.kind;
    if (initialPlanStatuses.has(value.status) && (!value.runId || planKind !== "initial" || value.clarification)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Initial-plan lifecycle states require a run ID and exactly one initial plan" });
    }
    if (recoveryPlanStatuses.has(value.status) && (!value.runId || planKind !== "recovery" || value.clarification)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Recovery lifecycle states require a run ID and exactly one recovery plan" });
    }
    if (value.status === "clarification_required" && (!value.clarification || value.activePlan || value.runId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "clarification_required requires clarification-only intake with no run or plan" });
    }
    if (noPlanStatuses.has(value.status) && (value.runId || value.activePlan || value.clarification)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "This lifecycle state must not expose a run, active plan, or clarification" });
    }
    if (value.status === "attention_required" && !value.attention) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attention"], message: "attention_required requires an attention reason" });
    }
    if (value.status !== "attention_required" && value.attention) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attention"], message: "Only attention_required may carry an attention reason" });
    }
    const activePlan = value.activePlan;
    if (activePlan && isInitialPlanView(activePlan)) {
      const selectedId = activePlan.selectedCandidate.candidateId;
      if (activePlan.assumptions[0].resolvedCandidateId !== selectedId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["activePlan", "assumptions", 0, "resolvedCandidateId"], message: "Active-plan assumption must resolve to the selected candidate" });
      }
      if (activePlan.alternatives[0].candidateId === selectedId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["activePlan", "alternatives", 0], message: "Selected and alternative candidates must be distinct" });
      }
    }
  });

export const CreateWorldPrRequestSchema = z
  .object({ request: z.string().trim().min(1).max(2000) })
  .strict();

export const CancelWorldPrRequestSchema = z.object({}).strict();

export const DashboardSessionRequestSchema = z.object({ passcode: z.string().min(1).max(200) }).strict();

export const TaskMutationResponseSchema = z
  .object({
    worldPrId: Id,
    status: TaskStatusSchema,
    activePlan: PlanPointerSchema.optional(),
    attention: AttentionReasonSchema.optional(),
    replayPending: z.literal(true).optional(),
    requestId: Id,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "attention_required" && !value.attention) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attention"], message: "Attention responses require a reason" });
    }
    if (value.status !== "attention_required" && value.attention) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attention"], message: "Only attention responses may carry a reason" });
    }
  });

export const CreateWorldPrResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      worldPrId: Id,
      status: z.literal("analyzing"),
      reviewUrl: z.string().url(),
      requestId: Id,
      replayPending: z.literal(true),
    })
    .strict(),
  z
    .object({
      worldPrId: Id,
      status: z.literal("preview_ready"),
      reviewUrl: z.string().url(),
      requestId: Id,
      replayPending: z.literal(true).optional(),
    })
    .strict(),
  z
    .object({
      worldPrId: Id,
      status: z.literal("clarification_required"),
      reviewUrl: z.string().url(),
      clarification: ClarificationSchema,
      requestId: Id,
      replayPending: z.literal(true).optional(),
    })
    .strict(),
]);

export const McpWorldPrStatusSchema = z
  .object({
    worldPrId: Id,
    status: TaskStatusSchema,
    reviewUrl: z.string().url(),
    clarification: ClarificationSchema.optional(),
    attention: AttentionReasonSchema.optional(),
    replayPending: z.literal(true).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "clarification_required" && !value.clarification) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["clarification"], message: "Clarification status must include the safe candidate prompt" });
    }
    if (value.status !== "clarification_required" && value.clarification) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["clarification"], message: "Only clarification status may expose candidate choices" });
    }
    if (value.status === "attention_required" && !value.attention) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attention"], message: "Attention status must include a safe attention reason" });
    }
    if (value.status !== "attention_required" && value.attention) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attention"], message: "Only attention status may expose an attention reason" });
    }
  });

export const IdempotencyFailureSchema = z
  .object({
    code: ErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    requestId: Id,
  })
  .strict();

export const ApiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: ErrorCodeSchema,
        message: z.string().min(1).max(500),
        retryable: z.boolean(),
        details: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      })
      .strict(),
    requestId: Id,
  })
  .strict();

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ActionStatus = z.infer<typeof ActionStatusSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type InitialPlanView = z.infer<typeof InitialPlanViewSchema>;
export type InitialPlanPayloadCore = z.infer<typeof InitialPlanPayloadCoreSchema>;
export type InitialPlanPayload = z.infer<typeof InitialPlanPayloadSchema>;
export type RecoveryPlanView = z.infer<typeof RecoveryPlanViewSchema>;
export type RecoveryPlanPayloadCore = z.infer<typeof RecoveryPlanPayloadCoreSchema>;
export type RecoveryPlanPayload = z.infer<typeof RecoveryPlanPayloadSchema>;
export type WorldPrView = z.infer<typeof WorldPrViewSchema>;
export type CreateWorldPrRequest = z.infer<typeof CreateWorldPrRequestSchema>;
export type CreateWorldPrResponse = z.infer<typeof CreateWorldPrResponseSchema>;
export type TaskMutationResponse = z.infer<typeof TaskMutationResponseSchema>;
export type PreventionRule = z.infer<typeof PreventionRuleSchema>;
export type ResetPlan = z.infer<typeof ResetPlanSchema>;
export type McpWorldPrStatus = z.infer<typeof McpWorldPrStatusSchema>;
export type TimelineItem = z.infer<typeof TimelineItemSchema>;

export function isInitialPlanView(plan: InitialPlanView | RecoveryPlanView): plan is InitialPlanView {
  return plan.pointer.kind === "initial";
}
