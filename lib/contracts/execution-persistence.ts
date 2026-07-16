import { z } from "zod";
import { GmailSendReceiptSchema, ArtifactReceiptSchema } from "@/lib/contracts/provider-ports";
import { ActionStatusSchema, OpaqueIdSchema, Rfc3339Schema, Sha256DigestSchema, VersionSchema } from "@/lib/contracts/v1";
import { sha256Digest } from "@/lib/domain/digest";

export const EXECUTION_PERSISTENCE_CONTRACT_VERSION = "execution-persistence.v1" as const;

export const PlanKindSchema = z.enum(["initial", "recovery", "reset"]);
export const ExecutionActionTypeSchema = z.enum([
  "artifact.account_brief",
  "calendar.move",
  "calendar.restore",
  "mail.notify",
  "mail.correct",
]);

export const ExecutionPlanCoreSchema = z
  .object({
    planId: OpaqueIdSchema,
    taskId: OpaqueIdSchema,
    kind: PlanKindSchema,
    version: VersionSchema,
    schemaVersion: z.string().min(1).max(100),
    promptVersion: z.string().min(1).max(100).nullable(),
    model: z.string().min(1).max(200).nullable(),
    payload: z.record(z.unknown()),
    createdAt: Rfc3339Schema,
  })
  .strict();

export const ExecutionPlanSchema = ExecutionPlanCoreSchema.extend({ digest: Sha256DigestSchema }).strict();

export const ApprovalRecordSchema = z
  .object({
    approvalId: OpaqueIdSchema,
    planId: OpaqueIdSchema,
    planVersion: VersionSchema,
    planDigest: Sha256DigestSchema,
    actorId: z.string().min(1).max(200),
    approvedAt: Rfc3339Schema,
  })
  .strict();

export const RedactedActionErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    retryable: z.boolean(),
    safeMessage: z.string().min(1).max(500),
  })
  .strict();

export const CalendarExecutionReceiptSchema = z
  .object({
    provider: z.literal("google_calendar"),
    operation: z.enum(["move", "restore"]),
    providerEventId: z.string().min(1).max(512),
    resultingEtag: z.string().min(1).max(200),
    verified: z.literal(true),
  })
  .strict();

export const ExecutionReceiptSchema = z.union([
  CalendarExecutionReceiptSchema,
  GmailSendReceiptSchema,
  ArtifactReceiptSchema,
]);

export const ActionExecutionRecordSchema = z
  .object({
    actionExecutionId: OpaqueIdSchema,
    planId: OpaqueIdSchema,
    actionKey: z.string().min(1).max(200),
    type: ExecutionActionTypeSchema,
    targetRef: z.string().min(1).max(600),
    operationKey: z.string().min(1).max(300),
    status: ActionStatusSchema,
    action: z.record(z.unknown()),
    beforeState: z.record(z.unknown()).optional(),
    afterState: z.record(z.unknown()).optional(),
    receipt: ExecutionReceiptSchema.optional(),
    attempts: z.number().int().min(0).max(100),
    leaseUntil: Rfc3339Schema.nullable(),
    dispatchStartedAt: Rfc3339Schema.nullable(),
    error: RedactedActionErrorSchema.optional(),
    startedAt: Rfc3339Schema.nullable(),
    finishedAt: Rfc3339Schema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const terminal = new Set(["succeeded", "retryable_failed", "delivery_uncertain", "conflict", "permanently_failed"]);
    if (value.status === "planned") {
      if (value.attempts !== 0 || value.startedAt !== null || value.finishedAt !== null || value.leaseUntil !== null || value.receipt || value.error) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Planned actions cannot have execution state" });
      }
    }
    if (value.status === "in_progress" && (!value.startedAt || !value.leaseUntil || value.finishedAt !== null || value.receipt || value.error)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "In-progress actions require an active lease and no terminal outcome" });
    }
    if (terminal.has(value.status) && value.finishedAt === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["finishedAt"], message: "Terminal actions require a completion timestamp" });
    }
    if (value.status === "succeeded" && !value.receipt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt"], message: "Succeeded actions require a typed receipt" });
    }
    if (value.status === "retryable_failed" && (!value.error || !value.error.retryable)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "Retryable actions require a retryable redacted error" });
    }
    if ((value.status === "delivery_uncertain" || value.status === "conflict" || value.status === "permanently_failed") && !value.error) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["error"], message: "Stopped actions require a redacted error" });
    }
    if (value.type === "mail.notify" || value.type === "mail.correct") {
      if (value.status === "in_progress" || value.status === "succeeded" || value.status === "delivery_uncertain" || value.status === "permanently_failed") {
        if (!value.dispatchStartedAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ["dispatchStartedAt"], message: "Gmail handoff requires a persisted dispatch marker" });
      }
      if (value.status === "retryable_failed" && value.dispatchStartedAt !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["dispatchStartedAt"], message: "Pre-handoff Gmail failures cannot have a dispatch marker" });
      }
    }
  });

export const ActionExecutionViewSchema = ActionExecutionRecordSchema;

export const ActionClaimSchema = z
  .object({
    claimed: z.boolean(),
    record: ActionExecutionRecordSchema,
  })
  .strict();

export type PlanKind = z.infer<typeof PlanKindSchema>;
export type ExecutionActionType = z.infer<typeof ExecutionActionTypeSchema>;
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
export type RedactedActionError = z.infer<typeof RedactedActionErrorSchema>;
export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;
export type ActionExecutionRecord = z.infer<typeof ActionExecutionRecordSchema>;
export type ActionClaim = z.infer<typeof ActionClaimSchema>;

export function computePlanPayloadDigest(payload: unknown): string {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Plan payload must be a JSON object.");
  }
  const withoutDigest = Object.fromEntries(Object.entries(payload as Record<string, unknown>).filter(([key]) => key !== "digest"));
  return sha256Digest(withoutDigest);
}

export function assertPlanPayloadDigest(payload: unknown, expectedDigest: string): void {
  if (computePlanPayloadDigest(payload) !== expectedDigest) throw new Error("Plan payload digest does not match the approved digest.");
}

export function stableOperationKey(planId: string, actionKey: string): string {
  return `${planId}:${actionKey}`;
}
