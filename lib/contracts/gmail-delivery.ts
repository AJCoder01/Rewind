import { z } from "zod";
import {
  GmailPermanentFailureReceiptSchema,
  GmailSendReceiptSchema,
  GmailSentReceiptSchema,
  GmailUncertainReceiptSchema,
} from "@/lib/contracts/provider-ports";
import { OpaqueIdSchema, Rfc3339Schema, Sha256DigestSchema } from "@/lib/contracts/v1";

export const GMAIL_DELIVERY_CONTRACT_VERSION = "gmail-delivery.v1" as const;

export const GmailActionKeySchema = z.enum([
  "initial.mail.notify",
  "recovery.mail.correct_uk",
  "recovery.mail.notify_us",
]);

export const GmailDispatchStatusSchema = z.enum([
  "planned",
  "in_progress",
  "retryable_failed",
  "succeeded",
  "permanently_failed",
  "delivery_uncertain",
]);

export const GmailDispatchIdentitySchema = z
  .object({
    actionId: OpaqueIdSchema,
    planId: OpaqueIdSchema,
    actionKey: GmailActionKeySchema,
    messageHash: Sha256DigestSchema,
    recipientDigest: Sha256DigestSchema,
  })
  .strict();

export const GmailDispatchRecordSchema = z
  .object({
    ...GmailDispatchIdentitySchema.shape,
    status: GmailDispatchStatusSchema,
    dispatchStartedAt: Rfc3339Schema.nullable(),
    receipt: GmailSendReceiptSchema.nullable(),
    errorCode: z.literal("local_preparation_failed").nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "retryable_failed" && value.dispatchStartedAt !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["dispatchStartedAt"], message: "Retryable Gmail failure cannot have a dispatch marker" });
    }
    if (value.status === "retryable_failed" && value.errorCode !== "local_preparation_failed") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "Retryable Gmail failure requires its local error code" });
    }
    if (value.status !== "retryable_failed" && value.errorCode !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "Only retryable Gmail failures may carry the local error code" });
    }
    if ((value.status === "succeeded" || value.status === "permanently_failed" || value.status === "delivery_uncertain") && value.dispatchStartedAt === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["dispatchStartedAt"], message: "A claimed Gmail dispatch requires a persisted marker" });
    }
    if (value.status === "succeeded" && value.receipt?.status !== "sent") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt"], message: "Succeeded Gmail dispatches require a sent receipt" });
    }
    if (value.status === "permanently_failed" && value.receipt?.status !== "permanent_failed") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt"], message: "Permanent Gmail failures require a permanent receipt" });
    }
    if (value.status === "delivery_uncertain" && value.receipt?.status !== "delivery_uncertain") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt"], message: "Uncertain Gmail dispatches require an uncertain receipt" });
    }
    if (value.status === "planned" || value.status === "in_progress") {
      if (value.receipt !== null || value.errorCode !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt"], message: "Open Gmail dispatches cannot have a terminal receipt or error" });
      }
    }
  });

const GmailDeliveryResultBaseSchema = z.object({ replay: z.boolean(), dispatchStartedAt: Rfc3339Schema.nullable() }).strict();

export const GmailDeliveryResultSchema = z.discriminatedUnion("status", [
  GmailDeliveryResultBaseSchema.extend({ status: z.literal("retryable_failed"), reason: z.literal("local_preparation") }),
  GmailDeliveryResultBaseSchema.extend({ status: z.literal("sent"), receipt: GmailSentReceiptSchema }),
  GmailDeliveryResultBaseSchema.extend({ status: z.literal("permanent_failed"), receipt: GmailPermanentFailureReceiptSchema }),
  GmailDeliveryResultBaseSchema.extend({ status: z.literal("delivery_uncertain"), receipt: GmailUncertainReceiptSchema }),
]);

export type GmailActionKey = z.infer<typeof GmailActionKeySchema>;
export type GmailDispatchIdentity = z.infer<typeof GmailDispatchIdentitySchema>;
export type GmailDispatchRecord = z.infer<typeof GmailDispatchRecordSchema>;
export type GmailDeliveryResult = z.infer<typeof GmailDeliveryResultSchema>;
