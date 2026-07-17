import { z } from "zod";
import { ActionExecutionRecordSchema, CalendarExecutionReceiptSchema } from "@/lib/contracts/execution-persistence";
import { CalendarEventSnapshotSchema } from "@/lib/contracts/provider-ports";
import { Sha256DigestSchema, VersionSchema } from "@/lib/contracts/v1";

export const INITIAL_CALENDAR_EXECUTION_CONTRACT_VERSION = "initial-calendar-execution.v1" as const;

export const InitialCalendarBeforeStateSchema = z
  .object({
    snapshot: CalendarEventSnapshotSchema,
    approvedPlanVersion: VersionSchema,
    approvedPlanDigest: Sha256DigestSchema,
  })
  .strict();

export const InitialCalendarAfterStateSchema = z
  .object({ snapshot: CalendarEventSnapshotSchema })
  .strict();

export const InitialCalendarMoveReceiptSchema = CalendarExecutionReceiptSchema.extend({ operation: z.literal("move") }).strict();

const InitialCalendarDecisionSchema = z.enum([
  "succeeded",
  "skipped",
  "busy",
  "blocked",
  "retryable_failed",
  "conflict",
  "permanently_failed",
]);

const InitialCalendarReasonSchema = z.enum([
  "active_lease",
  "provider_unavailable",
  "provider_not_found",
  "provider_conflict",
  "precondition_changed",
  "verification_failed",
  "calendar_uncertain",
  "invalid_snapshot",
  "invalid_configuration",
  "reconciliation_required",
  "conflict",
  "permanently_failed",
]);

export const InitialCalendarExecutionResultSchema = z
  .object({
    contractVersion: z.literal(INITIAL_CALENDAR_EXECUTION_CONTRACT_VERSION),
    decision: InitialCalendarDecisionSchema,
    record: ActionExecutionRecordSchema,
    receipt: InitialCalendarMoveReceiptSchema.optional(),
    reason: InitialCalendarReasonSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.decision === "succeeded" || value.decision === "skipped") && value.record.status !== "succeeded") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Successful Calendar decisions require a succeeded action record" });
    }
    if (value.decision === "succeeded" && !value.receipt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt"], message: "A fresh Calendar success requires its typed receipt" });
    }
    if (value.decision === "busy" && value.record.status !== "in_progress") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Busy Calendar decisions require an in-progress action record" });
    }
    if (value.decision === "retryable_failed" && value.record.status !== "retryable_failed") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Retryable Calendar decisions require a retryable failure record" });
    }
    if (value.decision === "conflict" && value.record.status !== "conflict") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Conflict Calendar decisions require a conflict record" });
    }
    if (value.decision === "permanently_failed" && value.record.status !== "permanently_failed") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Permanent Calendar decisions require a permanent failure record" });
    }
    if (value.decision === "blocked" && !value.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Blocked Calendar decisions require a durable reason" });
    }
    if (value.decision !== "blocked" && value.decision !== "busy" && value.decision !== "retryable_failed" && value.decision !== "conflict" && value.decision !== "permanently_failed" && value.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "This Calendar decision cannot carry a blocking reason" });
    }
  });

export type InitialCalendarBeforeState = z.infer<typeof InitialCalendarBeforeStateSchema>;
export type InitialCalendarAfterState = z.infer<typeof InitialCalendarAfterStateSchema>;
export type InitialCalendarMoveReceipt = z.infer<typeof InitialCalendarMoveReceiptSchema>;
export type InitialCalendarExecutionResult = z.infer<typeof InitialCalendarExecutionResultSchema>;
