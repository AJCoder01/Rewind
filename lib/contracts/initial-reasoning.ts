import { z } from "zod";
import {
  InitialModelInputSchema,
  type InitialModelInput,
} from "@/lib/contracts/provider-ports";
import { ModelMetadataSchema, Sha256DigestSchema } from "@/lib/contracts/v1";

export const INITIAL_REASONING_RECORD_CONTRACT_VERSION = "initial-reasoning-record.v1" as const;

export const InitialReasoningProposalRecordSchema = z
  .object({
    schemaVersion: z.literal("initial-reasoning.v1"),
    selectedCandidateId: z.enum(["cal_event_acme_uk", "cal_event_acme_us"]),
    assumption: z
      .object({
        assumptionId: z.literal("assumption_acme_region"),
        statement: z.string().min(1).max(500),
        resolvedCandidateId: z.enum(["cal_event_acme_uk", "cal_event_acme_us"]),
        evidence: z.array(z.string().min(1).max(500)).min(1).max(10),
        confidence: z.number().min(0).max(1),
      })
      .strict(),
    dependencyEdges: z
      .array(
        z
          .object({
            actionKey: z.enum(["initial.artifact.account_brief", "initial.calendar.move", "initial.mail.notify"]),
            assumptionIds: z.array(z.literal("assumption_acme_region")).max(1),
          })
          .strict(),
      )
      .length(3),
    accountBrief: z
      .object({ title: z.string().min(1).max(200), content: z.string().min(1).max(5000), sourceId: z.literal("acme_parent_account_notes") })
      .strict(),
  })
  .strict();

export const InitialReasoningRecordSchema = z
  .object({
    contractVersion: z.literal(INITIAL_REASONING_RECORD_CONTRACT_VERSION),
    request: z.string().min(1).max(2000),
    candidateResolutionDigest: Sha256DigestSchema,
    modelInput: InitialModelInputSchema,
    proposal: InitialReasoningProposalRecordSchema,
    metadata: ModelMetadataSchema,
    attempts: z.number().int().min(1).max(2),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type InitialReasoningRecord = z.infer<typeof InitialReasoningRecordSchema>;
export type InitialReasoningModelInput = InitialModelInput;
