import { z } from "zod";
import {
  ModelMetadataSchema,
  Rfc3339Schema,
  Sha256DigestSchema,
  ZonedDateTimeSchema,
} from "@/lib/contracts/v1";

export const PROVIDER_PORTS_CONTRACT_VERSION = "provider-ports.v1" as const;

const ProviderIdentifierSchema = z.string().min(1).max(512);

export const CalendarEventSnapshotSchema = z
  .object({
    calendarId: ProviderIdentifierSchema,
    providerEventId: ProviderIdentifierSchema,
    title: z.string().min(1).max(200),
    company: z.literal("Acme"),
    region: z.enum(["UK", "US"]),
    start: ZonedDateTimeSchema,
    end: ZonedDateTimeSchema,
    etag: z.string().min(1).max(200),
    providerUpdated: Rfc3339Schema,
    organizerDigest: Sha256DigestSchema,
    attendeeSetDigest: Sha256DigestSchema,
    eventType: z.literal("default"),
    recurringEventId: z.null(),
    ownedByConnectedAccount: z.literal(true),
    privateTags: z
      .object({ rewind_demo: z.literal("acme-renewal"), region: z.enum(["UK", "US"]) })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.end.instant) <= Date.parse(value.start.instant)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "Calendar event end must be after start" });
    }
    if (value.privateTags.region !== value.region) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["privateTags", "region"], message: "Calendar tag region must match event region" });
    }
  });

export const CalendarCandidateQuerySchema = z
  .object({ calendarId: ProviderIdentifierSchema, tag: z.literal("acme-renewal") })
  .strict();

export const CalendarEventReferenceSchema = z
  .object({ calendarId: ProviderIdentifierSchema, providerEventId: ProviderIdentifierSchema })
  .strict();

export const CalendarConditionalTimeUpdateSchema = z
  .object({
    calendarId: ProviderIdentifierSchema,
    providerEventId: ProviderIdentifierSchema,
    expectedEtag: z.string().min(1).max(200),
    start: ZonedDateTimeSchema,
    end: ZonedDateTimeSchema,
    sendUpdates: z.literal("none"),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.end.instant) <= Date.parse(value.start.instant)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "Calendar update end must be after start" });
    }
  });

export const GmailApprovedMessageSchema = z
  .object({
    senderGoogleSub: ProviderIdentifierSchema,
    to: z.array(z.string().email().max(320)).min(1).max(2),
    subject: z.string().min(1).max(200),
    bodyText: z.string().min(1).max(5000),
    bodyHash: Sha256DigestSchema,
    runId: ProviderIdentifierSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.to.map((address) => address.toLowerCase())).size !== value.to.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Gmail recipients must be unique" });
    }
  });

export const GmailSendReceiptSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("sent"), messageId: ProviderIdentifierSchema, threadId: ProviderIdentifierSchema.optional() })
    .strict(),
  z
    .object({ status: z.literal("permanent_failed"), providerCode: z.string().min(1).max(100) })
    .strict(),
  z
    .object({
      status: z.literal("delivery_uncertain"),
      reason: z.enum(["transport_timeout", "provider_5xx", "malformed_success", "process_interrupted"]),
    })
    .strict(),
]);

export const AccountBriefArtifactInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(5000),
    contentHash: Sha256DigestSchema,
    provenance: z
      .object({
        sourceId: z.literal("acme_parent_account_notes"),
        sourceDigest: Sha256DigestSchema,
        excludedDimensions: z
          .tuple([z.literal("calendar_event"), z.literal("region"), z.literal("attendees"), z.literal("meeting_time")])
          .readonly(),
        validatorVersion: z.string().min(1).max(100),
      })
      .strict(),
  })
  .strict();

export const ArtifactReceiptSchema = z
  .object({ artifactId: ProviderIdentifierSchema, contentHash: Sha256DigestSchema, storedAt: Rfc3339Schema })
  .strict();

export const ModelOperationSchema = z.enum(["initial", "recovery", "prevention_rule"]);

export const InitialModelInputSchema = z
  .object({
    request: z.string().min(1).max(2000),
    candidateEvidence: z.array(z.string().min(1).max(500)).length(2),
    allowedCandidateIds: z.array(ProviderIdentifierSchema).length(2),
    allowedActionKeys: z.array(z.string().min(1).max(200)).min(1).max(8),
  })
  .strict();

export const RecoveryModelInputSchema = z
  .object({
    lateContext: z.string().min(1).max(5000),
    completedActionIds: z.array(ProviderIdentifierSchema).min(1).max(8),
    allowedOutcomes: z.array(z.enum(["restore", "correct", "preserve", "apply"])).min(1).max(4),
    allowedActionKeys: z.array(z.string().min(1).max(200)).min(1).max(8),
  })
  .strict();

export const PreventionRuleModelInputSchema = z
  .object({
    sourceTaskId: ProviderIdentifierSchema,
    candidateIds: z.array(ProviderIdentifierSchema).length(2),
    ruleType: z.literal("calendar_company_region_ambiguity"),
    allowedAction: z.literal("ask_for_confirmation"),
  })
  .strict();

export const ModelProposalResponseSchema = z
  .object({ kind: ModelOperationSchema, rawOutput: z.unknown(), metadata: ModelMetadataSchema })
  .strict();

export type CalendarEventSnapshot = z.infer<typeof CalendarEventSnapshotSchema>;
export type CalendarCandidateQuery = z.infer<typeof CalendarCandidateQuerySchema>;
export type CalendarEventReference = z.infer<typeof CalendarEventReferenceSchema>;
export type CalendarConditionalTimeUpdate = z.infer<typeof CalendarConditionalTimeUpdateSchema>;
export type GmailApprovedMessage = z.infer<typeof GmailApprovedMessageSchema>;
export type GmailSendReceipt = z.infer<typeof GmailSendReceiptSchema>;
export type AccountBriefArtifactInput = z.infer<typeof AccountBriefArtifactInputSchema>;
export type ArtifactReceipt = z.infer<typeof ArtifactReceiptSchema>;
export type ModelOperation = z.infer<typeof ModelOperationSchema>;
export type InitialModelInput = z.infer<typeof InitialModelInputSchema>;
export type RecoveryModelInput = z.infer<typeof RecoveryModelInputSchema>;
export type PreventionRuleModelInput = z.infer<typeof PreventionRuleModelInputSchema>;
export type ModelProposalResponse = z.infer<typeof ModelProposalResponseSchema>;
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;
