import { z } from "zod";
import { CALENDAR_DEMO_CONTRACT_VERSION } from "@/lib/contracts/calendar-demo";

export const PROVIDER_SPIKE_CONTRACT_VERSION = "provider-spike.v1" as const;

const FingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{16}$/, "Fingerprints must be redacted SHA-256 prefixes");

const PreflightSchema = z
  .object({
    status: z.literal("ok"),
    contractVersion: z.literal(CALENDAR_DEMO_CONTRACT_VERSION),
    candidateCount: z.literal(2),
    baselineCount: z.literal(2),
    expectedVersionCount: z.literal(2),
  })
  .strict();

const ReceiptCoreSchema = z
  .object({
    status: z.enum(["succeeded", "conflict"]),
    reason: z.literal("provider_conflict").optional(),
  })
  .strict();

const ModelOperationSummarySchema = z
  .object({
    operation: z.enum(["initial", "recovery", "prevention_rule"]),
    status: z.literal("validated"),
    schemaVersion: z.string().min(1).max(100),
    attempts: z.number().int().min(1).max(2),
    model: z.string().min(1).max(200),
    responseIdFingerprint: FingerprintSchema,
  })
  .strict();

const InitialOperationSummarySchema = ModelOperationSummarySchema.extend({
  operation: z.literal("initial"),
  schemaVersion: z.literal("initial-reasoning.v1"),
});
const RecoveryOperationSummarySchema = ModelOperationSummarySchema.extend({
  operation: z.literal("recovery"),
  schemaVersion: z.literal("recovery-proposal.v1"),
});
const PreventionOperationSummarySchema = ModelOperationSummarySchema.extend({
  operation: z.literal("prevention_rule"),
  schemaVersion: z.literal("prevention-rule-proposal.v1"),
});

export const ProviderSpikeReportSchema = z
  .object({
    status: z.literal("ok"),
    operation: z.literal("provider_model_spikes"),
    contractVersion: z.literal(PROVIDER_SPIKE_CONTRACT_VERSION),
    calendar: z
      .object({
        preflightBefore: PreflightSchema,
        staleConflict: ReceiptCoreSchema.extend({ status: z.literal("conflict"), reason: z.literal("provider_conflict") }),
        move: ReceiptCoreSchema.extend({ status: z.literal("succeeded") }),
        restore: ReceiptCoreSchema.extend({ status: z.literal("succeeded") }),
        preflightAfter: PreflightSchema,
        partialReceiptStatuses: z
          .object({
            uk: z.tuple([z.literal("succeeded"), z.literal("succeeded")]),
            us: z.tuple([z.literal("conflict")]),
          })
          .strict(),
      })
      .strict(),
    model: z
      .object({
        operations: z.tuple([InitialOperationSummarySchema, RecoveryOperationSummarySchema, PreventionOperationSummarySchema]),
      })
      .strict(),
    productExecution: z.literal("disabled"),
    productReset: z.literal("disabled"),
    externalEffects: z.literal("calendar_move_restore_only"),
  })
  .strict();

export type ProviderSpikeReport = z.infer<typeof ProviderSpikeReportSchema>;
