import { z } from "zod";
import { InitialPlanPayloadSchema } from "@/lib/contracts/v1";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";

/**
 * Server-only integrity validation for an immutable initial plan.
 *
 * The shared structural schema remains browser-safe. Every server boundary that
 * creates or reads a persisted plan must use this schema so hashes are never
 * treated as trusted strings merely because their shape is valid.
 */
export const VerifiedInitialPlanPayloadSchema = InitialPlanPayloadSchema.superRefine((value, context) => {
  const { digest, ...core } = value;
  if (sha256Digest(core) !== digest) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["digest"], message: "Plan digest does not match the canonical payload" });
  }

  const [artifact, , mail] = value.actions;
  if (sha256Text(artifact.desired.content) !== artifact.desired.contentHash) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", 0, "desired", "contentHash"], message: "Account brief hash must match the exact approved content" });
  }
  if (sha256Text(mail.desired.bodyText) !== mail.desired.bodyHash) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", 2, "desired", "bodyHash"], message: "Mail body hash must match the exact approved body" });
  }
});
