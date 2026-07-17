import { z } from "zod";
import { ActionExecutionRecordSchema } from "@/lib/contracts/execution-persistence";
import { ArtifactReceiptSchema } from "@/lib/contracts/provider-ports";
import { Rfc3339Schema, Sha256DigestSchema } from "@/lib/contracts/v1";

export const INITIAL_ARTIFACT_EXECUTION_CONTRACT_VERSION = "initial-artifact-execution.v1" as const;

export const InitialArtifactBeforeStateSchema = z
  .object({
    contentHash: Sha256DigestSchema,
    sourceId: z.literal("acme_parent_account_notes"),
    sourceVersion: z.literal("controlled-content.v1"),
    sourceDigest: Sha256DigestSchema,
    validatorVersion: z.string().min(1).max(100),
  })
  .strict();

export const InitialArtifactAfterStateSchema = z
  .object({
    artifactId: z.string().min(1).max(512),
    contentHash: Sha256DigestSchema,
    storedAt: Rfc3339Schema,
  })
  .strict();

const InitialArtifactDecisionSchema = z.enum([
  "succeeded",
  "skipped",
  "busy",
  "blocked",
  "retryable_failed",
  "permanently_failed",
  "conflict",
]);

const InitialArtifactReasonSchema = z.enum([
  "active_lease",
  "artifact_unavailable",
  "artifact_invalid",
  "artifact_persistence_uncertain",
  "conflict",
  "permanently_failed",
  "reconciliation_required",
]);

export const InitialArtifactExecutionResultSchema = z
  .object({
    contractVersion: z.literal(INITIAL_ARTIFACT_EXECUTION_CONTRACT_VERSION),
    decision: InitialArtifactDecisionSchema,
    record: ActionExecutionRecordSchema,
    receipt: ArtifactReceiptSchema.optional(),
    reason: InitialArtifactReasonSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.decision === "succeeded" || value.decision === "skipped") && value.record.status !== "succeeded") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Successful artifact decisions require a succeeded action record" });
    }
    if (value.decision === "succeeded" && !value.receipt) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt"], message: "A fresh artifact success requires its typed receipt" });
    }
    if (value.decision === "busy" && value.record.status !== "in_progress") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Busy artifact decisions require an in-progress action record" });
    }
    if (value.decision === "retryable_failed" && value.record.status !== "retryable_failed") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Retryable artifact decisions require a retryable failure record" });
    }
    if (value.decision === "permanently_failed" && value.record.status !== "permanently_failed") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Permanent artifact decisions require a permanent failure record" });
    }
    if (value.decision === "conflict" && value.record.status !== "conflict") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["record", "status"], message: "Conflict artifact decisions require a conflict record" });
    }
    if (value.decision === "blocked" && !value.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Blocked artifact decisions require a durable reason" });
    }
    if (value.decision !== "blocked" && value.decision !== "busy" && value.decision !== "retryable_failed" && value.decision !== "permanently_failed" && value.decision !== "conflict" && value.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "This artifact decision cannot carry a blocking reason" });
    }
  });

export type InitialArtifactBeforeState = z.infer<typeof InitialArtifactBeforeStateSchema>;
export type InitialArtifactAfterState = z.infer<typeof InitialArtifactAfterStateSchema>;
export type InitialArtifactExecutionResult = z.infer<typeof InitialArtifactExecutionResultSchema>;
