import { z } from "zod";
import { CandidateSchema, Rfc3339Schema, Sha256DigestSchema } from "@/lib/contracts/v1";
import { ControlledCalendarCandidateIdSchema } from "@/lib/contracts/calendar-demo";
import { sha256Digest } from "@/lib/domain/digest";

export const CANDIDATE_RESOLUTION_CONTRACT_VERSION = "candidate-resolution.v1" as const;

const CandidateId = ControlledCalendarCandidateIdSchema;

export const CandidateResolutionCandidateSchema = CandidateSchema.extend({
  providerEventId: z.string().min(1).max(512),
  region: z.enum(["UK", "US"]),
  start: z.object({ instant: Rfc3339Schema, timeZone: z.literal("America/New_York") }).strict(),
  end: z.object({ instant: Rfc3339Schema, timeZone: z.literal("America/New_York") }).strict(),
  etag: z.string().min(1).max(200),
  attendeeSetDigest: Sha256DigestSchema,
  rankingEvidence: z.array(z.string().min(1).max(500)).min(1).max(4),
}).strict();

export const CandidateResolutionSnapshotSchema = z
  .object({
    contractVersion: z.literal(CANDIDATE_RESOLUTION_CONTRACT_VERSION),
    calendarId: z.string().min(1).max(512),
    demoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    resolutionVersion: z.number().int().min(1).max(1000),
    supersedesPlanId: z.string().min(8).max(200).optional(),
    candidates: z.tuple([CandidateResolutionCandidateSchema, CandidateResolutionCandidateSchema]),
    rankedCandidateIds: z.tuple([CandidateId, CandidateId]),
    selectedCandidateId: CandidateId,
    alternativeCandidateIds: z.tuple([CandidateId]),
    snapshotDigest: Sha256DigestSchema,
    resolvedAt: Rfc3339Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.candidates.map((candidate) => candidate.candidateId);
    const regions = value.candidates.map((candidate) => candidate.region);
    if (new Set(ids).size !== 2 || !ids.includes("cal_event_acme_uk") || !ids.includes("cal_event_acme_us")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates"], message: "Resolution must contain UK and US exactly once" });
    }
    if (new Set(regions).size !== 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidates"], message: "Resolution regions must be distinct" });
    }
    if (value.rankedCandidateIds[0] !== value.selectedCandidateId || value.alternativeCandidateIds[0] !== value.rankedCandidateIds[1]) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["rankedCandidateIds"], message: "Selected and alternative IDs must follow the deterministic ranking" });
    }
    if (value.selectedCandidateId !== "cal_event_acme_uk") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedCandidateId"], message: "The controlled initial ranking must select UK" });
    }
    const digestCore = {
      calendarId: value.calendarId,
      demoDate: value.demoDate,
      candidates: value.candidates,
      rankedCandidateIds: value.rankedCandidateIds,
      selectedCandidateId: value.selectedCandidateId,
      alternativeCandidateIds: value.alternativeCandidateIds,
    };
    if (value.snapshotDigest !== sha256Digest(digestCore)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["snapshotDigest"], message: "Resolution digest is invalid" });
    }
  });

export const RulePrecheckNoMatchSchema = z
  .object({ matched: z.literal(false) })
  .strict();

export const RulePrecheckMatchSchema = z
  .object({
    matched: z.literal(true),
    ruleId: z.string().min(8).max(200),
    question: z.string().min(1).max(500),
    candidates: z.array(CandidateSchema).length(2),
  })
  .strict();

export const RulePrecheckResultSchema = z.discriminatedUnion("matched", [RulePrecheckNoMatchSchema, RulePrecheckMatchSchema]);

export const PlanningLockLeaseSchema = z
  .object({
    acquired: z.literal(true),
    worldPrId: z.string().min(8).max(200),
    leaseUntil: Rfc3339Schema,
  })
  .strict();

export type CandidateResolutionCandidate = z.infer<typeof CandidateResolutionCandidateSchema>;
export type CandidateResolutionSnapshot = z.infer<typeof CandidateResolutionSnapshotSchema>;
export type RulePrecheckResult = z.infer<typeof RulePrecheckResultSchema>;
export type PlanningLockLease = z.infer<typeof PlanningLockLeaseSchema>;
