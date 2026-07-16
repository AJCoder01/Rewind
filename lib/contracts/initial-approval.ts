import { z } from "zod";
import { OpaqueIdSchema, Sha256DigestSchema, VersionSchema } from "@/lib/contracts/v1";

export const INITIAL_APPROVAL_CONTRACT_VERSION = "initial-approval.v1" as const;

export const InitialPlanMutationRequestSchema = z
  .object({
    planId: OpaqueIdSchema,
    planVersion: VersionSchema,
    planDigest: Sha256DigestSchema,
  })
  .strict();

export const InitialApprovalRequestSchema = InitialPlanMutationRequestSchema;
export const InitialReplanRequestSchema = InitialPlanMutationRequestSchema;

export type InitialPlanMutationRequest = z.infer<typeof InitialPlanMutationRequestSchema>;
