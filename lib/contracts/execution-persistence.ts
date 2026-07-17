import { z } from "zod";
import {
  CalendarExecutionReceiptSchema,
  ExecutionActionTypeSchema,
  ExecutionReceiptSchema,
  RedactedActionErrorSchema,
} from "@/lib/contracts/execution-shared";
import {
  ArtifactReceiptSchema,
  GmailPermanentFailureReceiptSchema,
  GmailSentReceiptSchema,
  GmailUncertainReceiptSchema,
} from "@/lib/contracts/provider-ports";
import { ActionStatusSchema, OpaqueIdSchema, Rfc3339Schema, Sha256DigestSchema, VersionSchema } from "@/lib/contracts/v1";
import { sha256Digest } from "@/lib/domain/digest";

export const EXECUTION_PERSISTENCE_CONTRACT_VERSION = "execution-persistence.v1" as const;

export const PlanKindSchema = z.enum(["initial", "recovery", "reset"]);
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

export const ExecutionPlanSchema = ExecutionPlanCoreSchema.extend({ digest: Sha256DigestSchema })
  .strict()
  .superRefine((value, context) => {
    if (computePlanPayloadDigest(value.payload) !== value.digest) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["digest"], message: "Execution plan digest must match the immutable payload" });
    }
    const payloadDigest = value.payload.digest;
    if (typeof payloadDigest === "string" && payloadDigest !== value.digest) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "digest"], message: "Embedded payload digest must match the execution plan digest" });
    }
  });

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

export { CalendarExecutionReceiptSchema, ExecutionActionTypeSchema, ExecutionReceiptSchema, RedactedActionErrorSchema } from "@/lib/contracts/execution-shared";

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
    const terminal = value.status === "succeeded" || value.status === "retryable_failed" || value.status === "delivery_uncertain" || value.status === "conflict" || value.status === "permanently_failed";
    const mail = value.type === "mail.notify" || value.type === "mail.correct";
    const addIssue = (path: (string | number)[], message: string) => {
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };
    if (value.status === "planned") {
      if (
        value.attempts !== 0 ||
        value.startedAt !== null ||
        value.finishedAt !== null ||
        value.leaseUntil !== null ||
        value.beforeState ||
        value.afterState ||
        value.receipt ||
        value.error
      ) {
        addIssue(["status"], "Planned actions cannot have execution state");
      }
    }
    if (
      value.status === "in_progress" &&
      (value.attempts < 1 || !value.startedAt || !value.leaseUntil || value.finishedAt !== null || value.receipt || value.error)
    ) {
      addIssue(["status"], "In-progress actions require an attempted active lease and no terminal outcome");
    }
    if (terminal && (value.finishedAt === null || value.leaseUntil !== null)) {
      addIssue(["finishedAt"], "Terminal actions require a completion timestamp and no active lease");
    }
    if (value.status === "succeeded" && !value.receipt) {
      addIssue(["receipt"], "Succeeded actions require a typed receipt");
    }
    if (value.status === "succeeded" && value.error) {
      addIssue(["error"], "Succeeded actions cannot carry an error");
    }
    if (value.status === "retryable_failed" && (!value.error || !value.error.retryable)) {
      addIssue(["error"], "Retryable actions require a retryable redacted error");
    }
    if (
      (value.status === "delivery_uncertain" || value.status === "conflict" || value.status === "permanently_failed") &&
      (!value.error || value.error.retryable)
    ) {
      addIssue(["error"], "Stopped actions require a non-retryable redacted error");
    }

    if (mail) {
      const postHandoff = value.status === "in_progress" || value.status === "succeeded" || value.status === "delivery_uncertain" || value.status === "permanently_failed";
      if (postHandoff && !value.dispatchStartedAt) {
        addIssue(["dispatchStartedAt"], "Gmail handoff requires a persisted dispatch marker");
      }
      if (postHandoff && (value.attempts < 1 || !value.startedAt)) {
        addIssue(["attempts"], "Post-handoff Gmail states require a claimed execution attempt");
      }
      if (!postHandoff && value.dispatchStartedAt !== null) {
        addIssue(["dispatchStartedAt"], "Pre-handoff Gmail states cannot have a dispatch marker");
      }
      if (
        (value.status === "retryable_failed" || value.status === "conflict") &&
        (value.attempts !== 0 || value.startedAt !== null)
      ) {
        addIssue(["attempts"], "Pre-handoff Gmail failures cannot claim a provider execution attempt");
      }

      const validReceipt = value.status === "succeeded"
        ? GmailSentReceiptSchema.safeParse(value.receipt).success
        : value.status === "delivery_uncertain"
          ? GmailUncertainReceiptSchema.safeParse(value.receipt).success
          : value.status === "permanently_failed"
            ? GmailPermanentFailureReceiptSchema.safeParse(value.receipt).success
            : value.receipt === undefined;
      if (!validReceipt) {
        addIssue(["receipt"], "The Gmail receipt must match the durable action status");
      }
    } else {
      if (value.dispatchStartedAt !== null) {
        addIssue(["dispatchStartedAt"], "Non-mail actions cannot have a Gmail dispatch marker");
      }
      if (value.status === "delivery_uncertain") {
        addIssue(["status"], "Delivery uncertainty is a Gmail-only action state");
      }

      const validSuccessReceipt = value.type === "artifact.account_brief"
        ? ArtifactReceiptSchema.safeParse(value.receipt).success
        : CalendarExecutionReceiptSchema.safeParse(value.receipt).success &&
          value.receipt !== undefined &&
          "operation" in value.receipt &&
          value.receipt.operation === (value.type === "calendar.move" ? "move" : "restore");
      if (value.status === "succeeded" ? !validSuccessReceipt : value.receipt !== undefined) {
        addIssue(["receipt"], "The non-mail receipt must match a successful immutable action type");
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
