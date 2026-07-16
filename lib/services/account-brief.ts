import { z } from "zod";
import { AccountBriefArtifactInputSchema, type AccountBriefArtifactInput, type ArtifactReceipt } from "@/lib/contracts/provider-ports";
import type { ArtifactPort as AccountBriefArtifactPort } from "@/lib/adapters/artifact";
import { sha256Text } from "@/lib/domain/digest";
import {
  ACCOUNT_BRIEF_CONTENT_FIXTURE,
  ACCOUNT_BRIEF_SOURCE_ID,
  ACCOUNT_BRIEF_TITLE,
  ACCOUNT_BRIEF_VALIDATOR_VERSION,
  CONTROLLED_CONTENT_VERSION,
  PARENT_ACCOUNT_NOTES_FIXTURE,
  assertAccountBriefIndependent,
} from "@/lib/domain/account-brief";

export const AccountBriefPlanningInputSchema = z
  .object({
    phase: z.literal("planning"),
    source: z
      .object({
        sourceId: z.literal(ACCOUNT_BRIEF_SOURCE_ID),
        sourceVersion: z.literal(CONTROLLED_CONTENT_VERSION),
        content: z.string().min(1).max(5000),
      })
      .strict(),
  })
  .strict();

export type AccountBriefPlanningInput = z.infer<typeof AccountBriefPlanningInputSchema>;

export type AccountBriefBoundaryErrorCode =
  | "planning_input_invalid"
  | "source_not_authorized"
  | "artifact_invalid";

export class AccountBriefBoundaryError extends Error {
  readonly code: AccountBriefBoundaryErrorCode;

  constructor(code: AccountBriefBoundaryErrorCode, cause?: unknown) {
    super("The account brief could not be validated safely.", cause === undefined ? undefined : { cause });
    this.name = "AccountBriefBoundaryError";
    this.code = code;
  }
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0].toLocaleLowerCase("en-US")}${value.slice(1)}`;
}

function renderAccountBrief(sourceText: string): string {
  const [, adoption, sponsorship, procurement, nextStep] = sourceText.split("\n");
  if (!adoption || !sponsorship || !procurement || !nextStep) {
    throw new AccountBriefBoundaryError("source_not_authorized");
  }
  return [
    ACCOUNT_BRIEF_TITLE,
    "",
    `- ${adoption.replace(/\.$/, "")}, but ${lowerFirst(sponsorship)}`,
    `- ${procurement}`,
    `- Next step: ${lowerFirst(nextStep)}`,
  ].join("\n");
}

function assertApprovedArtifact(input: unknown): AccountBriefArtifactInput {
  const parsed = AccountBriefArtifactInputSchema.safeParse(input);
  if (!parsed.success) throw new AccountBriefBoundaryError("artifact_invalid", parsed.error);
  const artifact = parsed.data;
  try {
    if (artifact.title !== ACCOUNT_BRIEF_TITLE) throw new Error("title_mismatch");
    if (artifact.provenance.sourceId !== ACCOUNT_BRIEF_SOURCE_ID) throw new Error("source_id_mismatch");
    if (artifact.provenance.sourceVersion !== CONTROLLED_CONTENT_VERSION) throw new Error("source_version_mismatch");
    if (artifact.provenance.sourceDigest !== sha256Text(PARENT_ACCOUNT_NOTES_FIXTURE)) throw new Error("source_digest_mismatch");
    if (artifact.provenance.validatorVersion !== ACCOUNT_BRIEF_VALIDATOR_VERSION) throw new Error("validator_version_mismatch");
    if (artifact.contentHash !== sha256Text(artifact.content)) throw new Error("content_hash_mismatch");
    assertAccountBriefIndependent(`${artifact.title}\n${artifact.content}`);
  } catch (error) {
    throw new AccountBriefBoundaryError("artifact_invalid", error);
  }
  return artifact;
}

/** Generate the controlled brief only while constructing a plan. */
export function generateAccountBriefForPlanning(input: AccountBriefPlanningInput): AccountBriefArtifactInput {
  const parsed = AccountBriefPlanningInputSchema.safeParse(input);
  if (!parsed.success) throw new AccountBriefBoundaryError("planning_input_invalid", parsed.error);
  if (parsed.data.source.content !== PARENT_ACCOUNT_NOTES_FIXTURE) {
    throw new AccountBriefBoundaryError("source_not_authorized");
  }

  const content = renderAccountBrief(parsed.data.source.content);
  return assertApprovedArtifact({
    title: ACCOUNT_BRIEF_TITLE,
    content,
    contentHash: sha256Text(content),
    provenance: {
      sourceId: ACCOUNT_BRIEF_SOURCE_ID,
      sourceVersion: CONTROLLED_CONTENT_VERSION,
      sourceDigest: sha256Text(parsed.data.source.content),
      excludedDimensions: ["calendar_event", "region", "attendees", "meeting_time"],
      validatorVersion: ACCOUNT_BRIEF_VALIDATOR_VERSION,
    },
  });
}

/** Persist the exact approved bytes; this function never regenerates content. */
export async function persistApprovedAccountBrief(port: AccountBriefArtifactPort, approved: AccountBriefArtifactInput): Promise<ArtifactReceipt> {
  return port.persistApprovedAccountBrief(assertApprovedArtifact(approved));
}

export const CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT: AccountBriefPlanningInput = {
  phase: "planning",
  source: {
    sourceId: ACCOUNT_BRIEF_SOURCE_ID,
    sourceVersion: CONTROLLED_CONTENT_VERSION,
    content: PARENT_ACCOUNT_NOTES_FIXTURE,
  },
};

export function isCanonicalGeneratedAccountBrief(artifact: AccountBriefArtifactInput): boolean {
  return artifact.content === ACCOUNT_BRIEF_CONTENT_FIXTURE;
}
