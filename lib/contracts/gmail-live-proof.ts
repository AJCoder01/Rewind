import { z } from "zod";
import { GmailApprovedMessageSchema, GmailSendReceiptSchema } from "@/lib/contracts/provider-ports";
import { OpaqueIdSchema, Rfc3339Schema, Sha256DigestSchema } from "@/lib/contracts/v1";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";

export const GMAIL_LIVE_PROOF_CONTRACT_VERSION = "gmail-live-proof.v1" as const;
export const GMAIL_LIVE_PROOF_TASK_ID = "wpr_s038_gmail_live_proof" as const;
export const GMAIL_LIVE_PROOF_PLAN_ID = "plan_s038_gmail_live_proof" as const;
export const GMAIL_LIVE_PROOF_ACTION_ID = "action_s038_gmail_live_proof" as const;
export const GMAIL_LIVE_PROOF_ACTION_KEY = "initial.mail.notify" as const;

const GmailLiveProofPlanCoreSchema = z
  .object({
    schemaVersion: z.literal(GMAIL_LIVE_PROOF_CONTRACT_VERSION),
    taskId: z.literal(GMAIL_LIVE_PROOF_TASK_ID),
    planId: z.literal(GMAIL_LIVE_PROOF_PLAN_ID),
    actionId: z.literal(GMAIL_LIVE_PROOF_ACTION_ID),
    actionKey: z.literal(GMAIL_LIVE_PROOF_ACTION_KEY),
    message: GmailApprovedMessageSchema,
    messageHash: Sha256DigestSchema,
    recipientDigest: Sha256DigestSchema,
    replayKey: Sha256DigestSchema,
  })
  .strict();

export const GmailLiveProofPlanSchema = GmailLiveProofPlanCoreSchema.extend({ digest: Sha256DigestSchema })
  .strict()
  .superRefine((value, context) => {
    const { digest, ...core } = value;
    if (digest !== sha256Digest(core)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["digest"], message: "Gmail proof plan digest does not match" });
    }
    if (value.message.bodyHash !== sha256Text(value.message.bodyText)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["message", "bodyHash"], message: "Gmail proof body hash does not match" });
    }
  });

export const GmailLiveProofActionSchema = z
  .object({
    schemaVersion: z.literal(GMAIL_LIVE_PROOF_CONTRACT_VERSION),
    source: z.literal("s038_tty_admin_exception"),
    replayKey: Sha256DigestSchema,
    messageHash: Sha256DigestSchema,
    recipientDigest: Sha256DigestSchema,
    desired: GmailApprovedMessageSchema,
  })
  .strict();

export const GmailLiveProofReadModelSchema = z
  .object({
    schemaVersion: z.literal(GMAIL_LIVE_PROOF_CONTRACT_VERSION),
    operation: z.literal("gmail_live_proof"),
    status: z.enum(["planned", "completed", "attention_required"]),
    runId: OpaqueIdSchema,
    actionId: z.literal(GMAIL_LIVE_PROOF_ACTION_ID),
    recipientDigest: Sha256DigestSchema,
    replayKey: Sha256DigestSchema,
    replayVerified: z.boolean(),
    firstStatus: z.enum(["pending", "sent", "permanent_failed", "delivery_uncertain", "retryable_failed"]),
    replayStatus: z.enum(["pending", "sent"]),
    updatedAt: Rfc3339Schema,
  })
  .strict();

export const GmailLiveProofStoredRecordSchema = z
  .object({
    plan: GmailLiveProofPlanSchema,
    actionStatus: z.enum(["planned", "in_progress", "succeeded", "retryable_failed", "delivery_uncertain", "permanently_failed"]),
    attempts: z.number().int().min(0).max(10),
    dispatchStartedAt: Rfc3339Schema.nullable(),
    receipt: GmailSendReceiptSchema.nullable(),
    readModel: GmailLiveProofReadModelSchema,
  })
  .strict();

export type GmailLiveProofPlan = z.infer<typeof GmailLiveProofPlanSchema>;
export type GmailLiveProofReadModel = z.infer<typeof GmailLiveProofReadModelSchema>;
export type GmailLiveProofStoredRecord = z.infer<typeof GmailLiveProofStoredRecordSchema>;
