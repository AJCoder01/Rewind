import { z } from "zod";
import { CalendarSemanticBaselineSchema, Rfc3339Schema, ZonedDateTimeSchema } from "@/lib/contracts/v1";
import { CalendarEventSnapshotSchema } from "@/lib/contracts/provider-ports";

export const CALENDAR_DEMO_CONTRACT_VERSION = "calendar-demo.v1" as const;
export const CONTROLLED_CALENDAR_CANDIDATE_IDS = ["cal_event_acme_uk", "cal_event_acme_us"] as const;
export const ControlledCalendarCandidateIdSchema = z.enum(CONTROLLED_CALENDAR_CANDIDATE_IDS);

const SeedReceiptSchema = z
  .object({
    operation: z.literal("seed"),
    runId: z.string().min(8).max(200),
    status: z.literal("succeeded"),
  })
  .strict();

export const CalendarOperationDesiredSchema = z
  .object({
    start: ZonedDateTimeSchema,
    end: ZonedDateTimeSchema,
    durationMinutes: z.literal(30),
    sendUpdates: z.literal("none"),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.end.instant) <= Date.parse(value.start.instant)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "Calendar operation end must be after start" });
    }
    if (Date.parse(value.end.instant) - Date.parse(value.start.instant) !== 30 * 60_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "Calendar operation must retain the 30-minute duration" });
    }
    if (value.start.timeZone !== value.end.timeZone) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["end", "timeZone"], message: "Calendar operation must retain one time zone" });
    }
  });

const CalendarProviderReceiptSchema = z
  .object({
    provider: z.literal("google_calendar"),
    operation: z.enum(["move", "restore"]),
    providerEventId: z.string().min(1).max(512),
    resultingEtag: z.string().min(1).max(200),
    verified: z.literal(true),
  })
  .strict();

const CalendarOperationStartedSchema = z
  .object({
    operation: z.enum(["move", "restore"]),
    runId: z.string().min(8).max(200),
    status: z.literal("started"),
    before: CalendarEventSnapshotSchema,
    desired: CalendarOperationDesiredSchema,
    lastVerifiedOperation: z.enum(["move", "restore"]).nullable(),
    lastVerifiedAfter: CalendarEventSnapshotSchema.nullable(),
  })
  .strict();

const CalendarOperationSucceededSchema = z
  .object({
    operation: z.enum(["move", "restore"]),
    runId: z.string().min(8).max(200),
    status: z.literal("succeeded"),
    before: CalendarEventSnapshotSchema,
    desired: CalendarOperationDesiredSchema,
    after: CalendarEventSnapshotSchema,
    receipt: CalendarProviderReceiptSchema,
    lastVerifiedOperation: z.enum(["move", "restore"]),
    lastVerifiedAfter: CalendarEventSnapshotSchema,
  })
  .strict();

const CalendarOperationConflictSchema = z
  .object({
    operation: z.enum(["move", "restore"]),
    runId: z.string().min(8).max(200),
    status: z.literal("conflict"),
    before: CalendarEventSnapshotSchema,
    desired: CalendarOperationDesiredSchema,
    after: CalendarEventSnapshotSchema.nullable(),
    reason: z.enum(["stale_state", "provider_conflict", "provider_not_found"]),
    lastVerifiedOperation: z.enum(["move", "restore"]).nullable(),
    lastVerifiedAfter: CalendarEventSnapshotSchema.nullable(),
  })
  .strict();

const CalendarOperationUncertainSchema = z
  .object({
    operation: z.enum(["move", "restore"]),
    runId: z.string().min(8).max(200),
    status: z.literal("uncertain"),
    before: CalendarEventSnapshotSchema,
    desired: CalendarOperationDesiredSchema,
    after: CalendarEventSnapshotSchema.nullable(),
    reason: z.enum(["provider_unavailable", "verification_failed"]),
    lastVerifiedOperation: z.enum(["move", "restore"]).nullable(),
    lastVerifiedAfter: CalendarEventSnapshotSchema.nullable(),
  })
  .strict();

export const CalendarOperationReceiptSchema = z.discriminatedUnion("status", [
  CalendarOperationStartedSchema,
  CalendarOperationSucceededSchema,
  CalendarOperationConflictSchema,
  CalendarOperationUncertainSchema,
]);

export const DemoEventStateReceiptSchema = z.union([SeedReceiptSchema, CalendarOperationReceiptSchema]);

export const DemoEventStateSchema = z
  .object({
    candidateId: ControlledCalendarCandidateIdSchema,
    semanticBaseline: CalendarSemanticBaselineSchema,
    expectedEtag: z.string().min(1).max(200),
    expectedUpdatedAt: Rfc3339Schema.nullable(),
    lastReceipt: DemoEventStateReceiptSchema,
  })
  .strict();

export const DemoSeedAuditMetadataSchema = z
  .object({
    operation: z.literal("seed"),
    candidateId: ControlledCalendarCandidateIdSchema,
    runId: z.string().min(8).max(200),
    status: z.enum(["started", "failed"]),
    failureKind: z.enum(["provider", "validation", "persistence"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "failed" && !value.failureKind) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["failureKind"], message: "Failed seed audit events require a failure kind" });
    }
    if (value.status === "started" && value.failureKind) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["failureKind"], message: "Started seed audit events cannot contain a failure kind" });
    }
  });

export type ControlledCalendarCandidateId = z.infer<typeof ControlledCalendarCandidateIdSchema>;
export type DemoEventState = z.infer<typeof DemoEventStateSchema>;
export type DemoEventStateReceipt = z.infer<typeof DemoEventStateReceiptSchema>;
export type CalendarOperationDesired = z.infer<typeof CalendarOperationDesiredSchema>;
export type CalendarOperationReceipt = z.infer<typeof CalendarOperationReceiptSchema>;
export type DemoSeedAuditMetadata = z.infer<typeof DemoSeedAuditMetadataSchema>;
