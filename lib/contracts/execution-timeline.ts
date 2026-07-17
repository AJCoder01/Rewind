import { z } from "zod";
import { ExecutionActionTypeSchema, ExecutionReceiptSchema, RedactedActionErrorSchema } from "@/lib/contracts/execution-shared";
import { ActionStatusSchema, OpaqueIdSchema, Rfc3339Schema, Sha256DigestSchema, TaskStatusSchema, VersionSchema } from "@/lib/contracts/v1";

export const EXECUTION_TIMELINE_CONTRACT_VERSION = "execution-timeline.v1" as const;

export const ExecutionOverallStatusSchema = z.enum([
  "awaiting_approval",
  "not_started",
  "in_progress",
  "completed",
  "partial",
  "attention_required",
  "cancelled",
  "failed",
]);

export const ExecutionActionViewSchema = z
  .object({
    actionExecutionId: OpaqueIdSchema,
    actionKey: z.string().min(1).max(200),
    type: ExecutionActionTypeSchema,
    label: z.string().min(1).max(200),
    effect: z.enum(["recorded_artifact", "external_effect"]),
    status: ActionStatusSchema,
    attempts: z.number().int().min(0).max(100),
    startedAt: Rfc3339Schema.nullable(),
    leaseUntil: Rfc3339Schema.nullable(),
    dispatchStartedAt: Rfc3339Schema.nullable(),
    finishedAt: Rfc3339Schema.nullable(),
    receipt: ExecutionReceiptSchema.optional(),
    error: RedactedActionErrorSchema.optional(),
  })
  .strict();

export const ExecutionTimelineViewSchema = z
  .object({
    contractVersion: z.literal(EXECUTION_TIMELINE_CONTRACT_VERSION),
    worldPrId: OpaqueIdSchema,
    taskStatus: TaskStatusSchema,
    overallStatus: ExecutionOverallStatusSchema,
    planId: OpaqueIdSchema.optional(),
    planVersion: VersionSchema.optional(),
    planDigest: Sha256DigestSchema.optional(),
    message: z.string().min(1).max(500).optional(),
    actions: z.array(ExecutionActionViewSchema).max(4),
    updatedAt: Rfc3339Schema,
  })
  .strict();

export type ExecutionOverallStatus = z.infer<typeof ExecutionOverallStatusSchema>;
export type ExecutionActionView = z.infer<typeof ExecutionActionViewSchema>;
export type ExecutionTimelineView = z.infer<typeof ExecutionTimelineViewSchema>;
