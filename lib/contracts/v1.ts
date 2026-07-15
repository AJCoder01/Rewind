import { z } from "zod";

const Rfc3339 = z.string().datetime({ offset: true });
const Id = z.string().min(8).max(200);
export const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

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

export const PlanPointerSchema = z
  .object({
    planId: Id,
    kind: z.literal("initial"),
    version: z.literal(1),
    digest: Sha256DigestSchema,
  })
  .strict();

export const CandidateSchema = z
  .object({
    candidateId: Id,
    label: z.string().min(1).max(100),
  })
  .strict();

const ZonedDateTimeSchema = z
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

const CalendarMoveActionSchema = z
  .object({
    actionKey: z.literal("initial.calendar.move"),
    type: z.literal("calendar.move"),
    dependsOnAssumptionIds: z.array(z.literal("assumption_acme_region")).length(1),
    externalEffect: z.literal(true),
    target: z.object({ calendarId: Id, providerEventId: Id }).strict(),
    preconditions: CalendarPreconditionsSchema,
    desired: z
      .object({
        start: ZonedDateTimeSchema,
        end: ZonedDateTimeSchema,
        durationMinutes: z.literal(30),
        sendUpdates: z.literal("none"),
      })
      .strict(),
  })
  .strict();

const MailNotificationActionSchema = z
  .object({
    actionKey: z.literal("initial.mail.notify"),
    type: z.literal("mail.notify"),
    dependsOnAssumptionIds: z.array(z.literal("assumption_acme_region")).length(1),
    externalEffect: z.literal(true),
    desired: z
      .object({
        senderGoogleSub: Id,
        to: z.array(z.string().email()).min(1).max(20),
        subject: z.string().min(1).max(200),
        bodyText: z.string().min(1).max(5000),
        bodyHash: Sha256DigestSchema,
        runId: Id,
      })
      .strict(),
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
    pointer: PlanPointerSchema,
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
    version: z.literal(1),
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

export const WorldPrViewSchema = z
  .object({
    worldPrId: Id,
    runId: Id,
    request: z.string().min(1).max(2000),
    status: TaskStatusSchema,
    activePlan: InitialPlanViewSchema.optional(),
    clarification: ClarificationSchema.optional(),
    timeline: z.array(TimelineItemSchema),
    createdAt: Rfc3339,
    updatedAt: Rfc3339,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "preview_ready" && (!value.activePlan || value.clarification)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "preview_ready requires exactly one active plan" });
    }
    if (value.status === "clarification_required" && (!value.clarification || value.activePlan)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "clarification_required requires a clarification and no active plan" });
    }
    if (value.activePlan) {
      const selectedId = value.activePlan.selectedCandidate.candidateId;
      if (value.activePlan.assumptions[0].resolvedCandidateId !== selectedId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["activePlan", "assumptions", 0, "resolvedCandidateId"], message: "Active-plan assumption must resolve to the selected candidate" });
      }
      if (value.activePlan.alternatives[0].candidateId === selectedId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["activePlan", "alternatives", 0], message: "Selected and alternative candidates must be distinct" });
      }
    }
  });

export const CreateWorldPrRequestSchema = z
  .object({ request: z.string().trim().min(1).max(2000) })
  .strict();

export const CreateWorldPrResponseSchema = z
  .object({
    worldPrId: Id,
    status: z.literal("preview_ready"),
    reviewUrl: z.string().url(),
    requestId: Id,
    replayPending: z.literal(true).optional(),
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
export type WorldPrView = z.infer<typeof WorldPrViewSchema>;
export type CreateWorldPrRequest = z.infer<typeof CreateWorldPrRequestSchema>;
export type CreateWorldPrResponse = z.infer<typeof CreateWorldPrResponseSchema>;
export type TimelineItem = z.infer<typeof TimelineItemSchema>;
