import { z } from "zod";
import {
  InitialPlanExpansionConfigurationSchema,
  InitialPlanExpansionResultSchema,
  type InitialPlanExpansionConfiguration,
  type InitialPlanExpansionResult,
} from "@/lib/contracts/initial-plan-expansion";
import {
  InitialPlanPayloadCoreSchema,
  type InitialPlanPayloadCore,
  type InitialPlanView,
} from "@/lib/contracts/v1";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { InitialReasoningRecordSchema, type InitialReasoningRecord } from "@/lib/contracts/initial-reasoning";
import { CandidateResolutionSnapshotSchema, type CandidateResolutionSnapshot } from "@/lib/contracts/candidate-resolution";
import { sha256Digest, sha256Text, canonicalJson } from "@/lib/domain/digest";
import { CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT, generateAccountBriefForPlanning } from "@/lib/services/account-brief";
import { assertRegisteredGmailTemplate } from "@/lib/domain/gmail-template";

export type InitialPlanExpansionErrorKind =
  | "reasoning_mismatch"
  | "recipient_not_allowed"
  | "time_conversion_invalid"
  | "plan_invalid";

export class InitialPlanExpansionError extends Error {
  readonly kind: InitialPlanExpansionErrorKind;

  constructor(kind: InitialPlanExpansionErrorKind) {
    super("Initial plan expansion failed safely.");
    this.name = "InitialPlanExpansionError";
    this.kind = kind;
  }
}

export type InitialPlanExpansionInput = Readonly<{
  request: string;
  taskId: string;
  planId: string;
  runId: string;
  version?: number;
  resolution: CandidateResolutionSnapshot;
  reasoning: InitialReasoningRecord;
  configuration: InitialPlanExpansionConfiguration;
  now?: Date;
}>;

function localDateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    throw new InitialPlanExpansionError("time_conversion_invalid");
  }
  return { year, month, day };
}

/** Convert a controlled America/New_York wall-clock time to a UTC instant. */
export function instantForNewYorkLocal(date: string, hour: number, minute: number): string {
  const { year, month, day } = localDateParts(date);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new InitialPlanExpansionError("time_conversion_invalid");
  }
  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute);
  const parts: Record<string, number> = {};
  try {
    for (const part of new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(nominalUtc))) {
      if (part.type !== "literal") parts[part.type] = Number(part.value);
    }
  } catch {
    throw new InitialPlanExpansionError("time_conversion_invalid");
  }
  const displayedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const instant = new Date(nominalUtc - (displayedAsUtc - nominalUtc));
  if (Number.isNaN(instant.getTime())) throw new InitialPlanExpansionError("time_conversion_invalid");
  return instant.toISOString();
}

function assertReasoningMatchesResolution(resolution: CandidateResolutionSnapshot, reasoning: InitialReasoningRecord, request: string): void {
  if (reasoning.candidateResolutionDigest !== resolution.snapshotDigest || reasoning.request !== request) {
    throw new InitialPlanExpansionError("reasoning_mismatch");
  }
  if (reasoning.proposal.selectedCandidateId !== resolution.selectedCandidateId || reasoning.proposal.assumption.resolvedCandidateId !== resolution.selectedCandidateId) {
    throw new InitialPlanExpansionError("reasoning_mismatch");
  }
  const dependencies = reasoning.proposal.dependencyEdges.map((edge) => ({ actionKey: edge.actionKey, assumptionIds: edge.assumptionIds }));
  const expected = [
    { actionKey: "initial.artifact.account_brief", assumptionIds: [] },
    { actionKey: "initial.calendar.move", assumptionIds: ["assumption_acme_region"] },
    { actionKey: "initial.mail.notify", assumptionIds: ["assumption_acme_region"] },
  ];
  if (canonicalJson(dependencies) !== canonicalJson(expected)) throw new InitialPlanExpansionError("reasoning_mismatch");
}

function candidateSetForResolution(resolution: CandidateResolutionSnapshot): InitialPlanPayloadCore["candidateSet"] {
  return resolution.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    providerEventId: candidate.providerEventId,
    title: candidate.label,
    company: "Acme" as const,
    region: candidate.region,
    start: candidate.start,
    end: candidate.end,
    etag: candidate.etag,
    attendeeSetDigest: candidate.attendeeSetDigest,
    rankingEvidence: candidate.rankingEvidence,
  })) as InitialPlanPayloadCore["candidateSet"];
}

function expansionConfiguration(value: InitialPlanExpansionConfiguration): InitialPlanExpansionConfiguration {
  return InitialPlanExpansionConfigurationSchema.parse(value);
}

export function expandInitialPlan(input: InitialPlanExpansionInput): InitialPlanExpansionResult {
  const request = z.string().trim().min(1).max(2000).parse(input.request);
  const resolution = CandidateResolutionSnapshotSchema.parse(input.resolution);
  const reasoning = InitialReasoningRecordSchema.parse(input.reasoning);
  const configuration = expansionConfiguration(input.configuration);
  assertReasoningMatchesResolution(resolution, reasoning, request);

  const selected = resolution.candidates.find((candidate) => candidate.candidateId === resolution.selectedCandidateId);
  const alternative = resolution.candidates.find((candidate) => candidate.candidateId === resolution.alternativeCandidateIds[0]);
  if (!selected || !alternative || selected.region !== "UK" || alternative.region !== "US") {
    throw new InitialPlanExpansionError("reasoning_mismatch");
  }
  const recipient = configuration.recipients.UK[0];
  if (!configuration.recipients.UK.includes(recipient) || configuration.recipients.US.includes(recipient)) {
    throw new InitialPlanExpansionError("recipient_not_allowed");
  }

  const accountBrief = generateAccountBriefForPlanning(CONTROLLED_ACCOUNT_BRIEF_PLANNING_INPUT);
  if (reasoning.proposal.accountBrief.title !== accountBrief.title || reasoning.proposal.accountBrief.sourceId !== accountBrief.provenance.sourceId) {
    throw new InitialPlanExpansionError("reasoning_mismatch");
  }

  const targetStart = instantForNewYorkLocal(resolution.demoDate, 15, 0);
  const targetEnd = new Date(Date.parse(targetStart) + 30 * 60_000).toISOString();
  const zoned = (instant: string) => ({ instant, timeZone: "America/New_York" as const });
  const calendar = {
    actionKey: "initial.calendar.move" as const,
    type: "calendar.move" as const,
    dependsOnAssumptionIds: ["assumption_acme_region" as const],
    externalEffect: true as const,
    target: { calendarId: configuration.calendarId, providerEventId: selected.providerEventId },
    preconditions: {
      expectedEtag: selected.etag,
      expectedStart: selected.start,
      expectedEnd: selected.end,
      organizerDigest: sha256Text(configuration.expectedEmail),
      attendeeSetDigest: selected.attendeeSetDigest,
      eventType: "default" as const,
      recurringEventId: null,
      ownedByConnectedAccount: true as const,
      privateTags: { rewind_demo: "acme-renewal" as const, region: selected.region },
    },
    desired: {
      start: zoned(targetStart),
      end: zoned(targetEnd),
      durationMinutes: 30 as const,
      sendUpdates: "none" as const,
    },
  };
  const bodyText = `The Acme UK renewal is now scheduled for ${resolution.demoDate} at 15:00 ET.`;
  const mail = {
    actionKey: "initial.mail.notify" as const,
    type: "mail.notify" as const,
    dependsOnAssumptionIds: ["assumption_acme_region" as const],
    externalEffect: true as const,
    desired: {
      senderGoogleSub: configuration.senderGoogleSub,
      to: [recipient],
      subject: `[Rewind ${input.runId}] Acme UK renewal moved`,
      bodyText,
      bodyHash: sha256Text(bodyText),
      runId: input.runId,
    },
    requiresSucceededActionKey: "initial.calendar.move" as const,
  };
  try {
    assertRegisteredGmailTemplate("initial.mail.notify", mail.desired);
  } catch {
    throw new InitialPlanExpansionError("plan_invalid");
  }
  const artifact = {
    actionKey: "initial.artifact.account_brief" as const,
    type: "artifact.account_brief" as const,
    dependsOnAssumptionIds: [] as never[],
    externalEffect: false as const,
    desired: accountBrief,
  };
  const core = InitialPlanPayloadCoreSchema.parse({
    schemaVersion: "initial-plan.v1",
    taskId: input.taskId,
    planId: input.planId,
    version: input.version ?? 1,
    request,
    candidateSet: candidateSetForResolution(resolution),
    selectedCandidateId: resolution.selectedCandidateId,
    alternativeCandidateIds: [resolution.alternativeCandidateIds[0]],
    assumptions: [reasoning.proposal.assumption],
    actions: [artifact, calendar, mail],
    accountBriefContentHash: accountBrief.contentHash,
    executionOrder: ["initial.artifact.account_brief", "initial.calendar.move", "initial.mail.notify"],
    modelMetadata: reasoning.metadata,
  });
  const digest = sha256Digest(core);
  const planPayload = VerifiedInitialPlanPayloadSchema.parse({ ...core, digest });
  const selectedView = { candidateId: selected.candidateId, label: selected.label };
  const alternativeView = { candidateId: alternative.candidateId, label: alternative.label };
  const planView = {
    pointer: { planId: input.planId, kind: "initial" as const, version: input.version ?? 1, digest },
    selectedCandidate: selectedView,
    alternatives: [alternativeView] as [typeof alternativeView],
    assumptions: planPayload.assumptions,
    actions: planPayload.actions,
  } satisfies InitialPlanView;
  return InitialPlanExpansionResultSchema.parse({
    contractVersion: "initial-plan-expansion.v1",
    planPayload,
    planView,
    candidateResolutionDigest: resolution.snapshotDigest,
    createdAt: (input.now ?? new Date()).toISOString(),
  });
}
