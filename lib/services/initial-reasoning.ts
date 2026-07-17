import {
  InitialReasoningRecordSchema,
  type InitialReasoningRecord,
} from "@/lib/contracts/initial-reasoning";
import {
  InitialModelInputSchema,
  INITIAL_MODEL_ACTION_KEYS,
  type InitialModelInput,
} from "@/lib/contracts/provider-ports";
import {
  CandidateResolutionSnapshotSchema,
  type CandidateResolutionSnapshot,
} from "@/lib/contracts/candidate-resolution";
import { requestValidatedInitialProposal } from "@/lib/ai/model-safety";
import type { ModelProposalPort } from "@/lib/ai/model";
import { generateAccountBriefForPlanning, CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT } from "@/lib/services/account-brief";

export type InitialReasoningInput = Readonly<{
  request: string;
  resolution: CandidateResolutionSnapshot;
  model: ModelProposalPort;
  now?: Date;
}>;

function modelInputFor(request: string, resolution: CandidateResolutionSnapshot): InitialModelInput {
  const candidates = resolution.candidates;
  return InitialModelInputSchema.parse({
    request,
    candidateEvidence: candidates.map((candidate) => `${candidate.label}: ${candidate.rankingEvidence.join(" ")}`) as [string, string],
    allowedCandidateIds: ["cal_event_acme_uk", "cal_event_acme_us"],
    allowedActionKeys: [...INITIAL_MODEL_ACTION_KEYS],
  });
}

/**
 * Ask for one bounded initial assumption/dependency proposal. Provider fields
 * and effect-bearing values remain outside the model input and are expanded in
 * the deterministic plan builder.
 */
export async function reasonInitialRequest(input: InitialReasoningInput): Promise<InitialReasoningRecord> {
  const resolution = CandidateResolutionSnapshotSchema.parse(input.resolution);
  const request = input.request.trim();
  const modelInput = modelInputFor(request, resolution);
  const accountBrief = generateAccountBriefForPlanning(CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT);
  const validated = await requestValidatedInitialProposal(input.model, modelInput, {
    expectedSelectedCandidateId: resolution.selectedCandidateId,
    expectedAccountBriefTitle: accountBrief.title,
  });
  return InitialReasoningRecordSchema.parse({
    contractVersion: "initial-reasoning-record.v1",
    request,
    candidateResolutionDigest: resolution.snapshotDigest,
    modelInput,
    proposal: validated.proposal,
    metadata: validated.metadata,
    attempts: validated.attempts,
    createdAt: (input.now ?? new Date()).toISOString(),
  });
}

export function buildInitialReasoningModelInput(request: string, resolution: CandidateResolutionSnapshot): InitialModelInput {
  return modelInputFor(request.trim(), CandidateResolutionSnapshotSchema.parse(resolution));
}
