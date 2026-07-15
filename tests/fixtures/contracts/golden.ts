import { z } from "zod";
import {
  ApiErrorResponseSchema,
  CreateWorldPrResponseSchema,
  ErrorCodeSchema,
  Sha256DigestSchema,
  TaskStatusSchema,
  WorldPrViewSchema,
  type TaskStatus,
  type WorldPrView,
} from "@/lib/contracts/v1";
import {
  ACCOUNT_BRIEF_CONTENT_FIXTURE,
  ACCOUNT_BRIEF_SOURCE_ID,
  ACCOUNT_BRIEF_TITLE,
  ACCOUNT_BRIEF_VALIDATOR_VERSION,
  PARENT_ACCOUNT_NOTES_FIXTURE,
} from "@/lib/domain/account-brief";
import { sha256Text } from "@/lib/domain/digest";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";

export const GOLDEN_CONTRACT_FIXTURE_VERSION = "golden-contracts.v1";
const GOLDEN_PLAN_DIGEST = `sha256:${"1".repeat(64)}`;
const GOLDEN_CONTENT_HASH = sha256Text(ACCOUNT_BRIEF_CONTENT_FIXTURE);
const GOLDEN_SOURCE_DIGEST = sha256Text(PARENT_ACCOUNT_NOTES_FIXTURE);
const GOLDEN_TIMESTAMP = "2026-07-15T10:00:00.000Z";

const ZonedDateTimeFixtureSchema = z
  .object({ instant: z.string().datetime({ offset: true }), timeZone: z.string().min(1).max(100) })
  .strict();

const GoldenAttentionReasonSchema = z
  .object({
    stage: z.enum(["initial", "recovery", "reset"]),
    kind: z.enum(["retryable_failure", "delivery_uncertain", "provider_conflict", "validation_failure", "permanent_failure", "partial_reset"]),
    actionKey: z.string().min(1).max(200).optional(),
  })
  .strict();

export const GoldenTaskStateFixtureSchema = z
  .object({
    fixtureVersion: z.literal(GOLDEN_CONTRACT_FIXTURE_VERSION),
    kind: z.literal("task_state"),
    state: TaskStatusSchema,
    view: WorldPrViewSchema,
    attention: GoldenAttentionReasonSchema.optional(),
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.state !== fixture.view.status) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["state"], message: "fixture state must match view status" });
    }
    if (fixture.state === "attention_required" && !fixture.attention) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attention"], message: "attention_required fixtures need an attention reason" });
    }
    if (fixture.state !== "attention_required" && fixture.attention) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attention"], message: "only attention_required fixtures may carry an attention reason" });
    }
  });

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

const GOLDEN_ACCOUNT_BRIEF_ACTION = {
  actionKey: "initial.artifact.account_brief" as const,
  type: "artifact.account_brief" as const,
  dependsOnAssumptionIds: [] as never[],
  externalEffect: false as const,
  desired: {
    title: ACCOUNT_BRIEF_TITLE,
    content: ACCOUNT_BRIEF_CONTENT_FIXTURE,
    contentHash: GOLDEN_CONTENT_HASH,
    provenance: {
      sourceId: ACCOUNT_BRIEF_SOURCE_ID,
      sourceDigest: GOLDEN_SOURCE_DIGEST,
      excludedDimensions: ["calendar_event", "region", "attendees", "meeting_time"] as ["calendar_event", "region", "attendees", "meeting_time"],
      validatorVersion: ACCOUNT_BRIEF_VALIDATOR_VERSION,
    },
  },
};

const GOLDEN_CALENDAR_ACTION = {
  actionKey: "initial.calendar.move" as const,
  type: "calendar.move" as const,
  dependsOnAssumptionIds: ["assumption_acme_region" as const],
  externalEffect: true as const,
  target: { calendarId: "fixture-demo-calendar", providerEventId: "fixture-event-uk" },
  preconditions: {
    expectedEtag: "fixture-uk-etag-v1",
    expectedStart: { instant: "2026-08-20T14:00:00.000Z", timeZone: "America/New_York" },
    expectedEnd: { instant: "2026-08-20T14:30:00.000Z", timeZone: "America/New_York" },
    organizerDigest: sha256Text("golden-organizer-uk-v1"),
    attendeeSetDigest: sha256Text("golden-attendees-uk-v1"),
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

const GOLDEN_MAIL_ACTION = {
  actionKey: "initial.mail.notify" as const,
  type: "mail.notify" as const,
  dependsOnAssumptionIds: ["assumption_acme_region" as const],
  externalEffect: true as const,
  desired: {
    senderGoogleSub: "fixture-team-account",
    to: ["uk-ops@example.test"],
    subject: "[Rewind run_golden_s016] Acme UK renewal moved",
    bodyText: "The Acme UK renewal is now scheduled for 2026-08-20 at 15:00 ET.",
    bodyHash: sha256Text("The Acme UK renewal is now scheduled for 2026-08-20 at 15:00 ET."),
    runId: "run_golden_s016",
  },
  requiresSucceededActionKey: "initial.calendar.move" as const,
};

export const GOLDEN_PREVIEW_VIEW: WorldPrView = WorldPrViewSchema.parse({
  worldPrId: "wpr_golden_s016",
  runId: "run_golden_s016",
  request: SUPPORTED_SCENARIO_REQUEST,
  status: "preview_ready",
  activePlan: {
    pointer: { planId: "plan_golden_s016", kind: "initial", version: 1, digest: GOLDEN_PLAN_DIGEST },
    selectedCandidate: { candidateId: "cal_event_acme_uk", label: "Acme UK renewal" },
    alternatives: [{ candidateId: "cal_event_acme_us", label: "Acme US renewal" }],
    assumptions: [GOLDEN_ASSUMPTION],
    actions: [GOLDEN_ACCOUNT_BRIEF_ACTION, GOLDEN_CALENDAR_ACTION, GOLDEN_MAIL_ACTION],
  },
  timeline: [
    { eventId: "evt_golden_created", type: "task.created", occurredAt: GOLDEN_TIMESTAMP, label: "World PR created", status: "preview_ready" },
    { eventId: "evt_golden_plan", type: "plan.persisted", occurredAt: GOLDEN_TIMESTAMP, label: "Complete golden plan persisted", status: "preview_ready" },
  ],
  createdAt: GOLDEN_TIMESTAMP,
  updatedAt: GOLDEN_TIMESTAMP,
});

const GOLDEN_CLARIFICATION = {
  question: "I found Acme UK and Acme US. Which one did you mean?",
  candidates: [
    { candidateId: "cal_event_acme_uk", label: "Acme UK renewal" },
    { candidateId: "cal_event_acme_us", label: "Acme US renewal" },
  ],
};

export const GOLDEN_TASK_STATUS_ORDER: readonly TaskStatus[] = [
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
];

function buildGoldenTaskState(state: TaskStatus) {
  const view = structuredClone(GOLDEN_PREVIEW_VIEW) as unknown as Record<string, unknown>;
  view.status = state;
  if (state === "clarification_required") {
    delete view.activePlan;
    view.clarification = GOLDEN_CLARIFICATION;
  } else {
    delete view.clarification;
  }
  return GoldenTaskStateFixtureSchema.parse({
    fixtureVersion: GOLDEN_CONTRACT_FIXTURE_VERSION,
    kind: "task_state",
    state,
    view,
    ...(state === "attention_required" ? { attention: { stage: "recovery", kind: "provider_conflict", actionKey: "recovery.calendar.move_us" } } : {}),
  });
}

export const GOLDEN_TASK_STATE_FIXTURES = GOLDEN_TASK_STATUS_ORDER.map(buildGoldenTaskState);
export const GOLDEN_TASK_STATES_BY_STATUS = Object.fromEntries(
  GOLDEN_TASK_STATE_FIXTURES.map((fixture) => [fixture.state, fixture]),
) as Readonly<Record<TaskStatus, (typeof GOLDEN_TASK_STATE_FIXTURES)[number]>>;

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
    worldPrId: "wpr_golden_s016",
    status: "preview_ready",
    reviewUrl: "https://rewind.example/pr/wpr_golden_s016",
    requestId: "req_golden_s016",
  }),
  CreateWorldPrResponseSchema.parse({
    worldPrId: "wpr_golden_s016",
    status: "preview_ready",
    reviewUrl: "https://rewind.example/pr/wpr_golden_s016",
    requestId: "req_golden_s016_replay",
    replayPending: true,
  }),
] as const;

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

export const GoldenResetPlanSchema = z
  .object({
    schemaVersion: z.literal("reset-plan.v1"),
    resetPlanId: z.string().min(8).max(200),
    runId: z.string().min(8).max(200),
    worldPrId: z.string().min(8).max(200),
    version: z.literal(1),
    targets: z.tuple([ResetTargetFixtureSchema, ResetTargetFixtureSchema]),
    executionOrder: z.tuple([z.literal("reset.calendar.uk"), z.literal("reset.calendar.us")]),
    sentMailRemains: z.literal(true),
    digest: Sha256DigestSchema,
  })
  .strict()
  .superRefine((plan, context) => {
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
  });

export const GOLDEN_RESET_PLAN = GoldenResetPlanSchema.parse({
  schemaVersion: "reset-plan.v1",
  resetPlanId: "rplan_golden_s016",
  runId: "run_golden_s016",
  worldPrId: "wpr_golden_s016",
  version: 1,
  targets: [
    {
      candidateId: "cal_event_acme_uk",
      semanticBaseline: {
        calendarId: "fixture-demo-calendar",
        providerEventId: "fixture-event-uk",
        start: { instant: "2026-08-20T14:00:00.000Z", timeZone: "America/New_York" },
        end: { instant: "2026-08-20T14:30:00.000Z", timeZone: "America/New_York" },
        durationMinutes: 30,
        organizerDigest: sha256Text("golden-organizer-uk-v1"),
        attendeeSetDigest: sha256Text("golden-attendees-uk-v1"),
        eventType: "default",
        recurringEventId: null,
        privateTags: { rewind_demo: "acme-renewal", region: "UK" },
      },
      approvedCurrentEtag: "fixture-uk-after-v1",
      approvedCurrentStart: { instant: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" },
      approvedCurrentEnd: { instant: "2026-08-20T19:30:00.000Z", timeZone: "America/New_York" },
      sendUpdates: "none",
    },
    {
      candidateId: "cal_event_acme_us",
      semanticBaseline: {
        calendarId: "fixture-demo-calendar",
        providerEventId: "fixture-event-us",
        start: { instant: "2026-08-20T15:00:00.000Z", timeZone: "America/New_York" },
        end: { instant: "2026-08-20T15:30:00.000Z", timeZone: "America/New_York" },
        durationMinutes: 30,
        organizerDigest: sha256Text("golden-organizer-us-v1"),
        attendeeSetDigest: sha256Text("golden-attendees-us-v1"),
        eventType: "default",
        recurringEventId: null,
        privateTags: { rewind_demo: "acme-renewal", region: "US" },
      },
      approvedCurrentEtag: "fixture-us-after-v1",
      approvedCurrentStart: { instant: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" },
      approvedCurrentEnd: { instant: "2026-08-20T19:30:00.000Z", timeZone: "America/New_York" },
      sendUpdates: "none",
    },
  ],
  executionOrder: ["reset.calendar.uk", "reset.calendar.us"],
  sentMailRemains: true,
  digest: `sha256:${"2".repeat(64)}`,
});

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
  archivedWorldPrId: "wpr_golden_s016",
  nextRunId: "run_golden_s017",
  calendarRestored: true,
  sentMailDeleted: false,
  requestId: "req_reset_golden_s016",
});

export const GoldenPreventionRuleSchema = z
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
    digest: Sha256DigestSchema,
  })
  .strict();

const GOLDEN_RULE_BASE = {
  schemaVersion: "prevention-rule.v1" as const,
  ruleId: "rule_golden_s016",
  version: 1 as const,
  type: "calendar_company_region_ambiguity" as const,
  company: "Acme" as const,
  minimumMatches: 2 as const,
  disambiguationField: "region" as const,
  protectedActions: ["calendar.move", "mail.notify"] as ["calendar.move", "mail.notify"],
  requiredAction: "ask_for_confirmation" as const,
  scope: "demo_workspace" as const,
  sourceTaskId: "wpr_golden_s016",
  displayText: "Ask which Acme region is intended when both controlled candidates match.",
  rationale: "The reviewed task resolved Acme UK while Acme US was also a valid candidate.",
  digest: `sha256:${"3".repeat(64)}`,
};

export const GOLDEN_RULE_PROPOSED = GoldenPreventionRuleSchema.parse({ ...GOLDEN_RULE_BASE, status: "proposed" });
export const GOLDEN_RULE_ACTIVE = GoldenPreventionRuleSchema.parse({ ...GOLDEN_RULE_BASE, status: "active" });
