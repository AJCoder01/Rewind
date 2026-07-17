import { z } from "zod";
import {
  ApiErrorResponseSchema,
  AttentionReasonSchema,
  CreateWorldPrResponseSchema,
  ErrorCodeSchema,
  InitialPlanPayloadCoreSchema,
  InitialPlanPayloadSchema,
  InitialPlanViewSchema,
  RecoveryPlanPayloadCoreSchema,
  RecoveryPlanPayloadSchema,
  RecoveryPlanViewSchema,
  Sha256DigestSchema,
  TaskStatusSchema,
  type TaskStatus,
  WorldPrViewSchema,
} from "@/lib/contracts/v1";
import {
  ACCOUNT_BRIEF_CONTENT_FIXTURE,
  ACCOUNT_BRIEF_SOURCE_ID,
  ACCOUNT_BRIEF_TITLE,
  ACCOUNT_BRIEF_VALIDATOR_VERSION,
  CONTROLLED_CONTENT_VERSION,
  PARENT_ACCOUNT_NOTES_FIXTURE,
} from "@/lib/domain/account-brief";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";

export const GOLDEN_CONTRACT_FIXTURE_VERSION = "golden-contracts.v1";
const GOLDEN_TIMESTAMP = "2026-07-15T10:00:00.000Z";
const GOLDEN_WORLD_PR_ID = "wpr_golden_s016";
const GOLDEN_RUN_ID = "run_golden_s016";
const GOLDEN_CONTENT_HASH = sha256Text(ACCOUNT_BRIEF_CONTENT_FIXTURE);
const GOLDEN_SOURCE_DIGEST = sha256Text(PARENT_ACCOUNT_NOTES_FIXTURE);

const GOLDEN_ASSUMPTION = {
  assumptionId: "assumption_acme_region" as const,
  statement: "Acme refers to Acme UK.",
  resolvedCandidateId: "cal_event_acme_uk",
  evidence: [
    "Acme UK is the nearest upcoming tagged candidate on the configured demo date.",
    "Acme US remains visible as the later alternative.",
  ],
  confidence: 0.82,
};

const GOLDEN_CANDIDATE_SET = [
  {
    candidateId: "cal_event_acme_uk",
    providerEventId: "fixture-event-uk",
    title: "Acme UK renewal",
    company: "Acme" as const,
    region: "UK" as const,
    start: { instant: "2026-08-20T14:00:00.000Z", timeZone: "America/New_York" },
    end: { instant: "2026-08-20T14:30:00.000Z", timeZone: "America/New_York" },
    etag: "fixture-uk-etag-v1",
    attendeeSetDigest: sha256Text("golden-attendees-uk-v1"),
    rankingEvidence: ["Tagged Acme renewal on the configured demo date.", "Nearest upcoming candidate: 10:00–10:30 ET."],
  },
  {
    candidateId: "cal_event_acme_us",
    providerEventId: "fixture-event-us",
    title: "Acme US renewal",
    company: "Acme" as const,
    region: "US" as const,
    start: { instant: "2026-08-20T15:00:00.000Z", timeZone: "America/New_York" },
    end: { instant: "2026-08-20T15:30:00.000Z", timeZone: "America/New_York" },
    etag: "fixture-us-etag-v1",
    attendeeSetDigest: sha256Text("golden-attendees-us-v1"),
    rankingEvidence: ["Tagged Acme renewal on the configured demo date.", "Visible later alternative: 11:00–11:30 ET."],
  },
] as const;

const GOLDEN_ACCOUNT_BRIEF_ACTION = {
  actionKey: "initial.artifact.account_brief" as const,
  type: "artifact.account_brief" as const,
  dependsOnAssumptionIds: [] as const,
  externalEffect: false as const,
  desired: {
    title: ACCOUNT_BRIEF_TITLE,
    content: ACCOUNT_BRIEF_CONTENT_FIXTURE,
    contentHash: GOLDEN_CONTENT_HASH,
    provenance: {
      sourceId: ACCOUNT_BRIEF_SOURCE_ID,
      sourceVersion: CONTROLLED_CONTENT_VERSION,
      sourceDigest: GOLDEN_SOURCE_DIGEST,
      excludedDimensions: ["calendar_event", "region", "attendees", "meeting_time"] as const,
      validatorVersion: ACCOUNT_BRIEF_VALIDATOR_VERSION,
    },
  },
};

const GOLDEN_CALENDAR_ACTION = {
  actionKey: "initial.calendar.move" as const,
  type: "calendar.move" as const,
  dependsOnAssumptionIds: ["assumption_acme_region"] as const,
  externalEffect: true as const,
  target: { calendarId: "fixture-demo-calendar", providerEventId: "fixture-event-uk" },
  preconditions: {
    expectedEtag: "fixture-uk-etag-v1",
    expectedStart: { instant: "2026-08-20T14:00:00.000Z", timeZone: "America/New_York" },
    expectedEnd: { instant: "2026-08-20T14:30:00.000Z", timeZone: "America/New_York" },
    organizerDigest: sha256Text("golden-organizer-uk-v1"),
    attendeeSetDigest: GOLDEN_CANDIDATE_SET[0].attendeeSetDigest,
    eventType: "default" as const,
    recurringEventId: null,
    ownedByConnectedAccount: true as const,
    privateTags: { rewind_demo: "acme-renewal" as const, region: "UK" as const },
  },
  desired: {
    start: { instant: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" },
    end: { instant: "2026-08-20T19:30:00.000Z", timeZone: "America/New_York" },
    durationMinutes: 30 as const,
    sendUpdates: "none" as const,
  },
};

const GOLDEN_MAIL_BODY = "The Acme UK renewal is now scheduled for 2026-08-20 at 15:00 ET.";
const GOLDEN_MAIL_ACTION = {
  actionKey: "initial.mail.notify" as const,
  type: "mail.notify" as const,
  dependsOnAssumptionIds: ["assumption_acme_region"] as const,
  externalEffect: true as const,
  desired: {
    senderGoogleSub: "fixture-team-account",
    to: ["uk-ops@example.test"],
    subject: `[Rewind ${GOLDEN_RUN_ID}] Acme UK renewal moved`,
    bodyText: GOLDEN_MAIL_BODY,
    bodyHash: sha256Text(GOLDEN_MAIL_BODY),
    runId: GOLDEN_RUN_ID,
  },
  requiresSucceededActionKey: "initial.calendar.move" as const,
};

export const GOLDEN_INITIAL_PLAN_CORE = InitialPlanPayloadCoreSchema.parse({
  schemaVersion: "initial-plan.v1",
  taskId: GOLDEN_WORLD_PR_ID,
  planId: "plan_golden_s016",
  version: 1,
  request: SUPPORTED_SCENARIO_REQUEST,
  candidateSet: GOLDEN_CANDIDATE_SET,
  selectedCandidateId: "cal_event_acme_uk",
  alternativeCandidateIds: ["cal_event_acme_us"],
  assumptions: [GOLDEN_ASSUMPTION],
  actions: [GOLDEN_ACCOUNT_BRIEF_ACTION, GOLDEN_CALENDAR_ACTION, GOLDEN_MAIL_ACTION],
  accountBriefContentHash: GOLDEN_CONTENT_HASH,
  executionOrder: ["initial.artifact.account_brief", "initial.calendar.move", "initial.mail.notify"],
  modelMetadata: {
    provider: "fixture",
    model: "fixture-initial.v1",
    promptVersion: "fixture-initial.v1",
    schemaVersion: "initial-reasoning.v1",
    reasoningEffort: "none",
    responseId: "fixture-response",
    source: "fixture",
  },
});

export const GOLDEN_INITIAL_PLAN_PAYLOAD = InitialPlanPayloadSchema.parse({
  ...GOLDEN_INITIAL_PLAN_CORE,
  digest: sha256Digest(GOLDEN_INITIAL_PLAN_CORE),
});

export const GOLDEN_INITIAL_PLAN_VIEW = InitialPlanViewSchema.parse({
  pointer: {
    planId: GOLDEN_INITIAL_PLAN_PAYLOAD.planId,
    kind: "initial",
    version: 1,
    digest: GOLDEN_INITIAL_PLAN_PAYLOAD.digest,
  },
  selectedCandidate: { candidateId: "cal_event_acme_uk", label: "Acme UK renewal" },
  alternatives: [{ candidateId: "cal_event_acme_us", label: "Acme US renewal" }],
  candidateEvidence: GOLDEN_CANDIDATE_SET.map((candidate) => ({
    candidateId: candidate.candidateId,
    label: candidate.title,
    region: candidate.region,
    start: candidate.start,
    end: candidate.end,
    rankingEvidence: candidate.rankingEvidence,
  })),
  assumptions: GOLDEN_INITIAL_PLAN_PAYLOAD.assumptions,
  actions: GOLDEN_INITIAL_PLAN_PAYLOAD.actions,
});

export const GOLDEN_PREVIEW_VIEW = WorldPrViewSchema.parse({
  worldPrId: GOLDEN_WORLD_PR_ID,
  runId: GOLDEN_RUN_ID,
  request: SUPPORTED_SCENARIO_REQUEST,
  status: "preview_ready",
  activePlan: GOLDEN_INITIAL_PLAN_VIEW,
  timeline: [
    { eventId: "evt_golden_created", type: "task.created", occurredAt: GOLDEN_TIMESTAMP, label: "World PR created", status: "preview_ready" },
    { eventId: "evt_golden_plan", type: "plan.persisted", occurredAt: GOLDEN_TIMESTAMP, label: "Complete golden plan persisted", status: "preview_ready" },
  ],
  createdAt: GOLDEN_TIMESTAMP,
  updatedAt: GOLDEN_TIMESTAMP,
});

const GOLDEN_RECOVERY_RESTORE_ACTION = {
  actionKey: "recovery.calendar.restore_uk" as const,
  type: "calendar.restore" as const,
  dependsOnAssumptionIds: ["assumption_acme_region"] as const,
  externalEffect: true as const,
  target: { calendarId: "fixture-demo-calendar", providerEventId: "fixture-event-uk" },
  preconditions: {
    ...GOLDEN_CALENDAR_ACTION.preconditions,
    expectedEtag: "fixture-uk-after-v1",
    expectedStart: GOLDEN_CALENDAR_ACTION.desired.start,
    expectedEnd: GOLDEN_CALENDAR_ACTION.desired.end,
  },
  desired: {
    start: GOLDEN_CALENDAR_ACTION.preconditions.expectedStart,
    end: GOLDEN_CALENDAR_ACTION.preconditions.expectedEnd,
    durationMinutes: 30 as const,
    sendUpdates: "none" as const,
  },
};

const GOLDEN_RECOVERY_MOVE_ACTION = {
  actionKey: "recovery.calendar.move_us" as const,
  type: "calendar.move" as const,
  dependsOnAssumptionIds: ["assumption_acme_region"] as const,
  externalEffect: true as const,
  target: { calendarId: "fixture-demo-calendar", providerEventId: "fixture-event-us" },
  preconditions: {
    expectedEtag: "fixture-us-etag-v1",
    expectedStart: GOLDEN_CANDIDATE_SET[1].start,
    expectedEnd: GOLDEN_CANDIDATE_SET[1].end,
    organizerDigest: sha256Text("golden-organizer-us-v1"),
    attendeeSetDigest: GOLDEN_CANDIDATE_SET[1].attendeeSetDigest,
    eventType: "default" as const,
    recurringEventId: null,
    ownedByConnectedAccount: true as const,
    privateTags: { rewind_demo: "acme-renewal" as const, region: "US" as const },
  },
  desired: {
    start: { instant: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" },
    end: { instant: "2026-08-20T19:30:00.000Z", timeZone: "America/New_York" },
    durationMinutes: 30 as const,
    sendUpdates: "none" as const,
  },
};

const GOLDEN_RECOVERY_CORRECTION_BODY = "Correction: the Acme UK renewal was restored to its original scheduled time.";
const GOLDEN_RECOVERY_CORRECTION_ACTION = {
  actionKey: "recovery.mail.correct_uk" as const,
  type: "mail.correct" as const,
  dependsOnAssumptionIds: ["assumption_acme_region"] as const,
  externalEffect: true as const,
  desired: {
    senderGoogleSub: "fixture-team-account",
    to: ["uk-ops@example.test"],
    subject: `[Rewind ${GOLDEN_RUN_ID}] Correction: Acme UK renewal restored`,
    bodyText: GOLDEN_RECOVERY_CORRECTION_BODY,
    bodyHash: sha256Text(GOLDEN_RECOVERY_CORRECTION_BODY),
    runId: GOLDEN_RUN_ID,
  },
  correctsActionExecutionId: "actexec_initial_mail",
  requiresSucceededActionKey: "recovery.calendar.restore_uk" as const,
};

const GOLDEN_RECOVERY_NOTIFICATION_BODY = "The Acme US renewal is now scheduled for 2026-08-20 at 15:00 ET.";
const GOLDEN_RECOVERY_NOTIFICATION_ACTION = {
  actionKey: "recovery.mail.notify_us" as const,
  type: "mail.notify" as const,
  dependsOnAssumptionIds: ["assumption_acme_region"] as const,
  externalEffect: true as const,
  desired: {
    senderGoogleSub: "fixture-team-account",
    to: ["us-ops@example.test"],
    subject: `[Rewind ${GOLDEN_RUN_ID}] Acme US renewal moved`,
    bodyText: GOLDEN_RECOVERY_NOTIFICATION_BODY,
    bodyHash: sha256Text(GOLDEN_RECOVERY_NOTIFICATION_BODY),
    runId: GOLDEN_RUN_ID,
  },
  requiresSucceededActionKey: "recovery.calendar.move_us" as const,
};

export const GOLDEN_RECOVERY_PLAN_CORE = RecoveryPlanPayloadCoreSchema.parse({
  schemaVersion: "recovery-plan.v1",
  taskId: GOLDEN_WORLD_PR_ID,
  planId: "plan_recovery_s016",
  version: 1,
  correctedAssumption: {
    assumptionId: "assumption_acme_region",
    fromCandidateId: "cal_event_acme_uk",
    toCandidateId: "cal_event_acme_us",
  },
  decisions: [
    { executedActionId: "actexec_initial_artifact", outcome: "preserve", explanation: "The account brief has independently validated provenance." },
    { executedActionId: "actexec_initial_calendar", outcome: "restore", explanation: "The calendar move depended on the invalidated region assumption." },
    { executedActionId: "actexec_initial_mail", outcome: "correct", explanation: "The sent UK notification is irreversible and needs a correction." },
  ],
  actions: [
    GOLDEN_RECOVERY_RESTORE_ACTION,
    GOLDEN_RECOVERY_MOVE_ACTION,
    GOLDEN_RECOVERY_CORRECTION_ACTION,
    GOLDEN_RECOVERY_NOTIFICATION_ACTION,
  ],
  preservedActionIds: ["actexec_initial_artifact"],
  executionOrder: ["recovery.calendar.restore_uk", "recovery.calendar.move_us", "recovery.mail.correct_uk", "recovery.mail.notify_us"],
  preconditions: {
    ukCurrentMustEqualInitialAfterState: GOLDEN_RECOVERY_RESTORE_ACTION.preconditions,
    usCurrentMustEqualRecoveryPreview: GOLDEN_RECOVERY_MOVE_ACTION.preconditions,
    originalUkMailReceiptId: "gmail_uk_receipt_s016",
    exactOriginalUkRecipientSetDigest: GOLDEN_CANDIDATE_SET[0].attendeeSetDigest,
    exactUsRecipientSetDigest: GOLDEN_CANDIDATE_SET[1].attendeeSetDigest,
    allCalendarPreflightsBeforeFirstWrite: true,
  },
  modelMetadata: {
    provider: "fixture",
    model: "fixture-recovery.v1",
    promptVersion: "fixture-recovery.v1",
    schemaVersion: "recovery-proposal.v1",
    reasoningEffort: "none",
    responseId: "fixture-recovery-response",
    source: "fixture",
  },
});

export const GOLDEN_RECOVERY_PLAN_PAYLOAD = RecoveryPlanPayloadSchema.parse({
  ...GOLDEN_RECOVERY_PLAN_CORE,
  digest: sha256Digest(GOLDEN_RECOVERY_PLAN_CORE),
});

export const GOLDEN_RECOVERY_PLAN_VIEW = RecoveryPlanViewSchema.parse({
  pointer: { planId: GOLDEN_RECOVERY_PLAN_PAYLOAD.planId, kind: "recovery", version: 1, digest: GOLDEN_RECOVERY_PLAN_PAYLOAD.digest },
  correctedAssumption: GOLDEN_RECOVERY_PLAN_PAYLOAD.correctedAssumption,
  decisions: GOLDEN_RECOVERY_PLAN_PAYLOAD.decisions,
  actions: GOLDEN_RECOVERY_PLAN_PAYLOAD.actions,
});

const GOLDEN_CLARIFICATION = {
  question: "I found Acme UK and Acme US. Which one did you mean?",
  candidates: [
    { candidateId: "cal_event_acme_uk", label: "Acme UK renewal" },
    { candidateId: "cal_event_acme_us", label: "Acme US renewal" },
  ],
};

export const GOLDEN_TASK_STATUS_ORDER: readonly TaskStatus[] = TaskStatusSchema.options;

export const GoldenTaskStateFixtureSchema = z
  .object({
    fixtureVersion: z.literal(GOLDEN_CONTRACT_FIXTURE_VERSION),
    kind: z.literal("task_state"),
    state: TaskStatusSchema,
    view: WorldPrViewSchema,
    attention: AttentionReasonSchema.optional(),
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.state !== fixture.view.status) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["state"], message: "fixture state must match view status" });
    }
    if (JSON.stringify(fixture.attention) !== JSON.stringify(fixture.view.attention)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attention"], message: "fixture attention must exactly mirror the read model" });
    }
  });

function buildTaskView(state: TaskStatus) {
  const common = {
    worldPrId: GOLDEN_WORLD_PR_ID,
    request: SUPPORTED_SCENARIO_REQUEST,
    status: state,
    timeline: [{ eventId: `evt_golden_${state}`, type: "task.state", occurredAt: GOLDEN_TIMESTAMP, label: `Golden state: ${state}`, status: state }],
    createdAt: GOLDEN_TIMESTAMP,
    updatedAt: GOLDEN_TIMESTAMP,
  };
  if (["preview_ready", "executing", "completed", "correction_pending"].includes(state)) {
    return WorldPrViewSchema.parse({ ...common, runId: GOLDEN_RUN_ID, activePlan: GOLDEN_INITIAL_PLAN_VIEW });
  }
  if (["recovery_ready", "recovering", "recovered"].includes(state)) {
    return WorldPrViewSchema.parse({ ...common, runId: GOLDEN_RUN_ID, activePlan: GOLDEN_RECOVERY_PLAN_VIEW });
  }
  if (state === "clarification_required") {
    return WorldPrViewSchema.parse({ ...common, clarification: GOLDEN_CLARIFICATION });
  }
  if (state === "attention_required") {
    const attention = { stage: "recovery" as const, kind: "provider_conflict" as const, actionKey: "recovery.calendar.move_us" };
    return WorldPrViewSchema.parse({ ...common, runId: GOLDEN_RUN_ID, activePlan: GOLDEN_RECOVERY_PLAN_VIEW, attention });
  }
  return WorldPrViewSchema.parse(common);
}

function buildGoldenTaskState(state: TaskStatus) {
  const view = buildTaskView(state);
  return GoldenTaskStateFixtureSchema.parse({
    fixtureVersion: GOLDEN_CONTRACT_FIXTURE_VERSION,
    kind: "task_state",
    state,
    view,
    ...(view.attention ? { attention: view.attention } : {}),
  });
}

export const GOLDEN_TASK_STATE_FIXTURES = GOLDEN_TASK_STATUS_ORDER.map(buildGoldenTaskState);

const RETRYABLE_ERROR_CODES = new Set(["provider_unavailable", "delivery_uncertain"]);

export const GOLDEN_ERROR_FIXTURES = ErrorCodeSchema.options.map((code) =>
  ApiErrorResponseSchema.parse({
    error: {
      code,
      message: `Fixture response for ${code}.`,
      retryable: RETRYABLE_ERROR_CODES.has(code),
      details: { fixtureVersion: GOLDEN_CONTRACT_FIXTURE_VERSION },
    },
    requestId: `req_error_${code}`,
  }),
);

export const GOLDEN_SUCCESS_FIXTURES = [
  CreateWorldPrResponseSchema.parse({
    worldPrId: GOLDEN_WORLD_PR_ID,
    status: "preview_ready",
    reviewUrl: `https://rewind.example/pr/${GOLDEN_WORLD_PR_ID}`,
    requestId: "req_golden_s016",
  }),
  CreateWorldPrResponseSchema.parse({
    worldPrId: GOLDEN_WORLD_PR_ID,
    status: "preview_ready",
    reviewUrl: `https://rewind.example/pr/${GOLDEN_WORLD_PR_ID}`,
    requestId: "req_golden_s016_replay",
    replayPending: true,
  }),
  CreateWorldPrResponseSchema.parse({
    worldPrId: "wpr_clarify_s016",
    status: "clarification_required",
    reviewUrl: "https://rewind.example/pr/wpr_clarify_s016",
    clarification: GOLDEN_CLARIFICATION,
    requestId: "req_clarify_s016",
  }),
] as const;

const ZonedDateTimeFixtureSchema = z
  .object({ instant: z.string().datetime({ offset: true }), timeZone: z.string().min(1).max(100) })
  .strict();
const DemoEventPrivateTagsFixtureSchema = z
  .object({ rewind_demo: z.literal("acme-renewal"), region: z.enum(["UK", "US"]) })
  .strict();
const CalendarSemanticBaselineSchema = z
  .object({
    calendarId: z.string().min(8).max(200),
    providerEventId: z.string().min(8).max(200),
    start: ZonedDateTimeFixtureSchema,
    end: ZonedDateTimeFixtureSchema,
    durationMinutes: z.literal(30),
    organizerDigest: Sha256DigestSchema,
    attendeeSetDigest: Sha256DigestSchema,
    eventType: z.literal("default"),
    recurringEventId: z.null(),
    privateTags: DemoEventPrivateTagsFixtureSchema,
  })
  .strict();
const ResetTargetFixtureSchema = z
  .object({
    candidateId: z.enum(["cal_event_acme_uk", "cal_event_acme_us"]),
    semanticBaseline: CalendarSemanticBaselineSchema,
    approvedCurrentEtag: z.string().min(1).max(200),
    approvedCurrentStart: ZonedDateTimeFixtureSchema,
    approvedCurrentEnd: ZonedDateTimeFixtureSchema,
    sendUpdates: z.literal("none"),
  })
  .strict();

const GoldenResetPlanCoreObjectSchema = z
  .object({
    schemaVersion: z.literal("reset-plan.v1"),
    resetPlanId: z.string().min(8).max(200),
    runId: z.string().min(8).max(200),
    worldPrId: z.string().min(8).max(200),
    version: z.literal(1),
    targets: z.tuple([ResetTargetFixtureSchema, ResetTargetFixtureSchema]),
    executionOrder: z.tuple([z.literal("reset.calendar.uk"), z.literal("reset.calendar.us")]),
    sentMailRemains: z.literal(true),
  })
  .strict();

function validateResetPlan(plan: z.infer<typeof GoldenResetPlanCoreObjectSchema>, context: z.RefinementCtx): void {
    const ids = plan.targets.map((target) => target.candidateId);
    if (new Set(ids).size !== 2 || !ids.includes("cal_event_acme_uk") || !ids.includes("cal_event_acme_us")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "reset targets must contain UK and US exactly once" });
    }
    for (const target of plan.targets) {
      const expectedRegion = target.candidateId.endsWith("_uk") ? "UK" : "US";
      if (target.semanticBaseline.privateTags.region !== expectedRegion) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["targets"], message: "reset target region must match its candidate" });
      }
    }
}

export const GoldenResetPlanCoreSchema = GoldenResetPlanCoreObjectSchema.superRefine(validateResetPlan);

export const GoldenResetPlanSchema = GoldenResetPlanCoreObjectSchema.extend({ digest: Sha256DigestSchema }).strict().superRefine(validateResetPlan);

export const GOLDEN_RESET_PLAN_CORE = GoldenResetPlanCoreSchema.parse({
  schemaVersion: "reset-plan.v1",
  resetPlanId: "rplan_golden_s016",
  runId: GOLDEN_RUN_ID,
  worldPrId: GOLDEN_WORLD_PR_ID,
  version: 1,
  targets: [
    {
      candidateId: "cal_event_acme_uk",
      semanticBaseline: {
        calendarId: "fixture-demo-calendar",
        providerEventId: "fixture-event-uk",
        start: GOLDEN_CALENDAR_ACTION.preconditions.expectedStart,
        end: GOLDEN_CALENDAR_ACTION.preconditions.expectedEnd,
        durationMinutes: 30,
        organizerDigest: GOLDEN_CALENDAR_ACTION.preconditions.organizerDigest,
        attendeeSetDigest: GOLDEN_CANDIDATE_SET[0].attendeeSetDigest,
        eventType: "default",
        recurringEventId: null,
        privateTags: { rewind_demo: "acme-renewal", region: "UK" },
      },
      approvedCurrentEtag: "fixture-uk-after-v1",
      approvedCurrentStart: GOLDEN_CALENDAR_ACTION.desired.start,
      approvedCurrentEnd: GOLDEN_CALENDAR_ACTION.desired.end,
      sendUpdates: "none",
    },
    {
      candidateId: "cal_event_acme_us",
      semanticBaseline: {
        calendarId: "fixture-demo-calendar",
        providerEventId: "fixture-event-us",
        start: GOLDEN_CANDIDATE_SET[1].start,
        end: GOLDEN_CANDIDATE_SET[1].end,
        durationMinutes: 30,
        organizerDigest: GOLDEN_RECOVERY_MOVE_ACTION.preconditions.organizerDigest,
        attendeeSetDigest: GOLDEN_CANDIDATE_SET[1].attendeeSetDigest,
        eventType: "default",
        recurringEventId: null,
        privateTags: { rewind_demo: "acme-renewal", region: "US" },
      },
      approvedCurrentEtag: "fixture-us-after-v1",
      approvedCurrentStart: GOLDEN_RECOVERY_MOVE_ACTION.desired.start,
      approvedCurrentEnd: GOLDEN_RECOVERY_MOVE_ACTION.desired.end,
      sendUpdates: "none",
    },
  ],
  executionOrder: ["reset.calendar.uk", "reset.calendar.us"],
  sentMailRemains: true,
});

export const GOLDEN_RESET_PLAN = GoldenResetPlanSchema.parse({ ...GOLDEN_RESET_PLAN_CORE, digest: sha256Digest(GOLDEN_RESET_PLAN_CORE) });

export const GoldenResetCompleteResponseSchema = z
  .object({
    status: z.literal("reset_complete"),
    resetPlanId: z.string().min(8).max(200),
    archivedWorldPrId: z.string().min(8).max(200),
    nextRunId: z.string().min(8).max(200),
    calendarRestored: z.literal(true),
    sentMailDeleted: z.literal(false),
    requestId: z.string().min(8).max(200),
  })
  .strict();

export const GOLDEN_RESET_SUCCESS = GoldenResetCompleteResponseSchema.parse({
  status: "reset_complete",
  resetPlanId: "rplan_golden_s016",
  archivedWorldPrId: GOLDEN_WORLD_PR_ID,
  nextRunId: "run_golden_s017",
  calendarRestored: true,
  sentMailDeleted: false,
  requestId: "req_reset_golden_s016",
});

export const GoldenPreventionRuleCoreSchema = z
  .object({
    schemaVersion: z.literal("prevention-rule.v1"),
    ruleId: z.string().min(8).max(200),
    version: z.literal(1),
    type: z.literal("calendar_company_region_ambiguity"),
    company: z.literal("Acme"),
    minimumMatches: z.literal(2),
    disambiguationField: z.literal("region"),
    protectedActions: z.tuple([z.literal("calendar.move"), z.literal("mail.notify")]),
    requiredAction: z.literal("ask_for_confirmation"),
    scope: z.literal("demo_workspace"),
    sourceTaskId: z.string().min(8).max(200),
    status: z.enum(["proposed", "active", "removed"]),
    displayText: z.string().min(1).max(500),
    rationale: z.string().min(1).max(1000),
  })
  .strict();

export const GoldenPreventionRuleSchema = GoldenPreventionRuleCoreSchema.extend({ digest: Sha256DigestSchema }).strict();

function goldenRule(status: "proposed" | "active" | "removed") {
  const core = GoldenPreventionRuleCoreSchema.parse({
    schemaVersion: "prevention-rule.v1",
    ruleId: "rule_golden_s016",
    version: 1,
    type: "calendar_company_region_ambiguity",
    company: "Acme",
    minimumMatches: 2,
    disambiguationField: "region",
    protectedActions: ["calendar.move", "mail.notify"],
    requiredAction: "ask_for_confirmation",
    scope: "demo_workspace",
    sourceTaskId: GOLDEN_WORLD_PR_ID,
    status,
    displayText: "Ask which Acme region is intended when both controlled candidates match.",
    rationale: "The reviewed task resolved Acme UK while Acme US was also a valid candidate.",
  });
  return GoldenPreventionRuleSchema.parse({ ...core, digest: sha256Digest(core) });
}

export const GOLDEN_RULE_PROPOSED = goldenRule("proposed");
export const GOLDEN_RULE_ACTIVE = goldenRule("active");
export const GOLDEN_RULE_REMOVED = goldenRule("removed");
