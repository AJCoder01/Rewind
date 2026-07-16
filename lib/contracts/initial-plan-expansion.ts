import { z } from "zod";
import { InitialPlanPayloadSchema, InitialPlanViewSchema, Sha256DigestSchema } from "@/lib/contracts/v1";
import { RecipientAllowlistSchema } from "@/lib/config/environment";

export const INITIAL_PLAN_EXPANSION_CONTRACT_VERSION = "initial-plan-expansion.v1" as const;

export const InitialPlanExpansionConfigurationSchema = z
  .object({
    calendarId: z.string().min(1).max(512),
    expectedEmail: z.string().email().max(320),
    senderGoogleSub: z.string().min(1).max(255).refine((value) => value === value.trim() && !/\s/.test(value)),
    recipients: RecipientAllowlistSchema,
  })
  .strict();

export const InitialPlanExpansionResultSchema = z
  .object({
    contractVersion: z.literal(INITIAL_PLAN_EXPANSION_CONTRACT_VERSION),
    planPayload: InitialPlanPayloadSchema,
    planView: InitialPlanViewSchema,
    candidateResolutionDigest: Sha256DigestSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type InitialPlanExpansionConfiguration = z.infer<typeof InitialPlanExpansionConfigurationSchema>;
export type InitialPlanExpansionResult = z.infer<typeof InitialPlanExpansionResultSchema>;
