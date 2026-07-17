import { z } from "zod";
import { ActionExecutionRecordSchema } from "@/lib/contracts/execution-persistence";
import { OpaqueIdSchema, Rfc3339Schema } from "@/lib/contracts/v1";

export const INITIAL_EXECUTION_CONTRACT_VERSION = "initial-execution.v1" as const;

const InitialActionDecisionSchema = z.enum(["claimed", "skipped", "busy", "blocked"]);
const InitialActionBlockReasonSchema = z.enum([
  "dependency_not_satisfied",
  "delivery_uncertain",
  "conflict",
  "permanently_failed",
  "reconciliation_required",
]);

export const InitialActionPreparationSchema = z
  .object({
    contractVersion: z.literal(INITIAL_EXECUTION_CONTRACT_VERSION),
    planId: OpaqueIdSchema,
    actions: z.tuple([ActionExecutionRecordSchema, ActionExecutionRecordSchema, ActionExecutionRecordSchema]),
    preparedAt: Rfc3339Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const expected = ["initial.artifact.account_brief", "initial.calendar.move", "initial.mail.notify"];
    if (JSON.stringify(value.actions.map((action) => action.actionKey)) !== JSON.stringify(expected)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["actions"], message: "Initial action rows must follow the fixed artifact, Calendar, Gmail order" });
    }
    if (value.actions.some((action) => action.planId !== value.planId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["actions"], message: "Every initial action row must belong to the prepared plan" });
    }
  });

export const InitialActionClaimResultSchema = z
  .object({
    contractVersion: z.literal(INITIAL_EXECUTION_CONTRACT_VERSION),
    decision: InitialActionDecisionSchema,
    record: ActionExecutionRecordSchema,
    reason: InitialActionBlockReasonSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "blocked" && !value.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Blocked claims require a safe durable reason" });
    }
    if (value.decision !== "blocked" && value.reason) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Only blocked claims may carry a block reason" });
    }
  });

export type InitialActionPreparation = z.infer<typeof InitialActionPreparationSchema>;
export type InitialActionClaimResult = z.infer<typeof InitialActionClaimResultSchema>;
