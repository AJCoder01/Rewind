import { z } from "zod";
import { CalendarSemanticBaselineSchema, Rfc3339Schema } from "@/lib/contracts/v1";

export const CALENDAR_DEMO_CONTRACT_VERSION = "calendar-demo.v1" as const;
export const CONTROLLED_CALENDAR_CANDIDATE_IDS = ["cal_event_acme_uk", "cal_event_acme_us"] as const;
export const ControlledCalendarCandidateIdSchema = z.enum(CONTROLLED_CALENDAR_CANDIDATE_IDS);

export const DemoEventStateReceiptSchema = z
  .object({
    operation: z.literal("seed"),
    runId: z.string().min(8).max(200),
    status: z.literal("succeeded"),
  })
  .strict();

export const DemoEventStateSchema = z
  .object({
    candidateId: ControlledCalendarCandidateIdSchema,
    semanticBaseline: CalendarSemanticBaselineSchema,
    expectedEtag: z.string().min(1).max(200),
    expectedUpdatedAt: Rfc3339Schema.nullable(),
    lastReceipt: DemoEventStateReceiptSchema,
  })
  .strict();

export const DemoSeedAuditMetadataSchema = z
  .object({
    operation: z.literal("seed"),
    candidateId: ControlledCalendarCandidateIdSchema,
    runId: z.string().min(8).max(200),
    status: z.enum(["started", "failed"]),
    failureKind: z.enum(["provider", "validation", "persistence"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "failed" && !value.failureKind) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["failureKind"], message: "Failed seed audit events require a failure kind" });
    }
    if (value.status === "started" && value.failureKind) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["failureKind"], message: "Started seed audit events cannot contain a failure kind" });
    }
  });

export type ControlledCalendarCandidateId = z.infer<typeof ControlledCalendarCandidateIdSchema>;
export type DemoEventState = z.infer<typeof DemoEventStateSchema>;
export type DemoEventStateReceipt = z.infer<typeof DemoEventStateReceiptSchema>;
export type DemoSeedAuditMetadata = z.infer<typeof DemoSeedAuditMetadataSchema>;
