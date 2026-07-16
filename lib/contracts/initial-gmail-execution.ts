import { z } from "zod";
import { ActionExecutionRecordSchema } from "@/lib/contracts/execution-persistence";
import { GmailSendReceiptSchema } from "@/lib/contracts/provider-ports";
import { Rfc3339Schema, Sha256DigestSchema, VersionSchema } from "@/lib/contracts/v1";

export const INITIAL_GMAIL_EXECUTION_CONTRACT_VERSION = "initial-gmail-execution.v1" as const;

export const InitialGmailBeforeStateSchema = z
  .object({
    messageHash: Sha256DigestSchema,
    recipientDigest: Sha256DigestSchema,
    approvedPlanVersion: VersionSchema,
    approvedPlanDigest: Sha256DigestSchema,
  })
  .strict();

export const InitialGmailAfterStateSchema = z
  .object({
    receipt: GmailSendReceiptSchema,
    recordedAt: Rfc3339Schema,
  })
  .strict();

const InitialGmailDecisionSchema = z.enum([
  "succeeded",
  "skipped",
  "busy",
  "blocked",
  "retryable_failed",
  "permanently_failed",
  "delivery_uncertain",
]);

const InitialGmailReasonSchema = z.enum([
  "active_lease",
  "local_preparation",
  "recipient_not_allowed",
  "sender_not_allowed",
  "unknown_template",
  "invalid_message",
  "provider_permanent_failure",
  "delivery_uncertain",
  "reconciliation_required",
  "conflict",
  "permanently_failed",
]);

export const InitialGmailExecutionResultSchema = z
  .object({
    contractVersion: z.literal(INITIAL_GMAIL_EXECUTION_CONTRACT_VERSION),
    decision: InitialGmailDecisionSchema,
    record: ActionExecutionRecordSchema,
    receipt: GmailSendReceiptSchema.optional(),
    reason: InitialGmailReasonSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.decision === "succeeded" || value.decision === "skipped") && value.record.status !== "succeeded") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Successful Gmail decisions require a succeeded action record" });
    }
    if (value.decision === "succeeded" && value.receipt?.status !== "sent") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt"], message: "A fresh Gmail success requires a sent receipt" });
    }
    if (value.decision === "busy" && value.record.status !== "in_progress") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Busy Gmail decisions require an in-progress action record" });
    }
    if (value.decision === "retryable_failed" && value.record.status !== "retryable_failed") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Retryable Gmail decisions require a retryable failure record" });
    }
    if (value.decision === "permanently_failed" && value.record.status !== "permanently_failed") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Permanent Gmail decisions require a permanent failure record" });
    }
    if (value.decision === "delivery_uncertain" && value.record.status !== "delivery_uncertain") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Uncertain Gmail decisions require an uncertain action record" });
    }
    if (value.decision === "blocked" && !value.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Blocked Gmail decisions require a durable reason" });
    }
    if (value.decision !== "blocked" && value.decision !== "busy" && value.decision !== "retryable_failed" && value.decision !== "permanently_failed" && value.decision !== "delivery_uncertain" && value.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "This Gmail decision cannot carry a blocking reason" });
    }
  });

export type InitialGmailBeforeState = z.infer<typeof InitialGmailBeforeStateSchema>;
export type InitialGmailAfterState = z.infer<typeof InitialGmailAfterStateSchema>;
export type InitialGmailExecutionResult = z.infer<typeof InitialGmailExecutionResultSchema>;
