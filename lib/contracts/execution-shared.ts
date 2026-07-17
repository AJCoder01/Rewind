import { z } from "zod";
import { ArtifactReceiptSchema, GmailSendReceiptSchema } from "@/lib/contracts/provider-ports";

export const ExecutionActionTypeSchema = z.enum([
  "artifact.account_brief",
  "calendar.move",
  "calendar.restore",
  "mail.notify",
  "mail.correct",
]);

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

export type ExecutionActionType = z.infer<typeof ExecutionActionTypeSchema>;
export type RedactedActionError = z.infer<typeof RedactedActionErrorSchema>;
export type CalendarExecutionReceipt = z.infer<typeof CalendarExecutionReceiptSchema>;
export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>;
