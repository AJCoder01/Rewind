import {
  InitialPlanPayloadCoreSchema,
  InitialPlanPayloadSchema,
  InitialPlanViewSchema,
  type InitialPlanPayload,
  type InitialPlanView,
  type TimelineItem,
  WorldPrViewSchema,
  type WorldPrView,
} from "@/lib/contracts/v1";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";
import { createOpaqueId } from "@/lib/domain/ids";

const demoDate = "2026-08-20";
const timeZone = "America/New_York";
const briefContent = [
  "Acme parent-account renewal risk brief",
  "",
  "- Adoption is healthy, but executive sponsorship should be reconfirmed.",
  "- Procurement timing is the main schedule risk.",
  "- Next step: confirm decision owners and renewal milestones.",
].join("\n");

function zoned(instant: string) {
  return { instant, timeZone };
}

function candidate(candidateId: string, label: string) {
  return { candidateId, label };
}

export interface FixtureWorldPrRecord {
  view: WorldPrView;
  planPayload: InitialPlanPayload;
}

export function buildFixtureWorldPrRecord(request: string, now = new Date()): FixtureWorldPrRecord {
  const worldPrId = createOpaqueId("wpr_");
  const runId = createOpaqueId("run_");
  const planId = createOpaqueId("plan_");
  const occurredAt = now.toISOString();
  const uk = candidate("cal_event_acme_uk", "Acme UK renewal");
  const us = candidate("cal_event_acme_us", "Acme US renewal");
  const ukAttendeeSetDigest = sha256Text("fixture-attendees-uk-v1");
  const usAttendeeSetDigest = sha256Text("fixture-attendees-us-v1");
  const preconditions = {
    expectedEtag: "fixture-uk-etag-v1",
    expectedStart: zoned("2026-08-20T14:00:00.000Z"),
    expectedEnd: zoned("2026-08-20T14:30:00.000Z"),
    organizerDigest: sha256Text("fixture-organizer-uk-v1"),
    attendeeSetDigest: ukAttendeeSetDigest,
    eventType: "default" as const,
    recurringEventId: null,
    ownedByConnectedAccount: true as const,
    privateTags: { rewind_demo: "acme-renewal" as const, region: "UK" as const },
  };
  const artifact = {
    actionKey: "initial.artifact.account_brief" as const,
    type: "artifact.account_brief" as const,
    dependsOnAssumptionIds: [] as never[],
    externalEffect: false as const,
    desired: {
      title: "Acme parent-account renewal risk brief",
      content: briefContent,
      contentHash: sha256Text(briefContent),
      provenance: {
        sourceId: "acme_parent_account_notes" as const,
        sourceDigest: sha256Text("fixture-parent-account-notes-v1"),
        excludedDimensions: ["calendar_event", "region", "attendees", "meeting_time"] as [
          "calendar_event",
          "region",
          "attendees",
          "meeting_time",
        ],
        validatorVersion: "artifact-independence.v1",
      },
    },
  };
  const calendar = {
    actionKey: "initial.calendar.move" as const,
    type: "calendar.move" as const,
    dependsOnAssumptionIds: ["assumption_acme_region" as const],
    externalEffect: true as const,
    target: { calendarId: "fixture-demo-calendar", providerEventId: "fixture-event-uk" },
    preconditions,
    desired: {
      start: zoned("2026-08-20T19:00:00.000Z"),
      end: zoned("2026-08-20T19:30:00.000Z"),
      durationMinutes: 30 as const,
      sendUpdates: "none" as const,
    },
  };
  const bodyText = `The Acme UK renewal is now scheduled for ${demoDate} at 15:00 ET.`;
  const mail = {
    actionKey: "initial.mail.notify" as const,
    type: "mail.notify" as const,
    dependsOnAssumptionIds: ["assumption_acme_region" as const],
    externalEffect: true as const,
    desired: {
      senderGoogleSub: "fixture-team-account",
      to: ["uk-ops@example.test"],
      subject: `[Rewind ${runId}] Acme UK renewal moved`,
      bodyText,
      bodyHash: sha256Text(bodyText),
      runId,
    },
    requiresSucceededActionKey: "initial.calendar.move" as const,
  };
  const actions = [artifact, calendar, mail] as InitialPlanView["actions"];
  const planPayloadCore = InitialPlanPayloadCoreSchema.parse({
    schemaVersion: "initial-plan.v1",
    taskId: worldPrId,
    planId,
    version: 1,
    request,
    candidateSet: [
      {
        candidateId: uk.candidateId,
        providerEventId: "fixture-event-uk",
        title: uk.label,
        company: "Acme",
        region: "UK",
        start: zoned("2026-08-20T14:00:00.000Z"),
        end: zoned("2026-08-20T14:30:00.000Z"),
        etag: "fixture-uk-etag-v1",
        attendeeSetDigest: ukAttendeeSetDigest,
        rankingEvidence: [
          "Tagged Acme renewal on the configured demo date.",
          "Nearest upcoming candidate: 10:00–10:30 ET.",
        ],
      },
      {
        candidateId: us.candidateId,
        providerEventId: "fixture-event-us",
        title: us.label,
        company: "Acme",
        region: "US",
        start: zoned("2026-08-20T15:00:00.000Z"),
        end: zoned("2026-08-20T15:30:00.000Z"),
        etag: "fixture-us-etag-v1",
        attendeeSetDigest: usAttendeeSetDigest,
        rankingEvidence: [
          "Tagged Acme renewal on the configured demo date.",
          "Visible later alternative: 11:00–11:30 ET.",
        ],
      },
    ],
    selectedCandidateId: uk.candidateId,
    alternativeCandidateIds: [us.candidateId],
    assumptions: [
      {
        assumptionId: "assumption_acme_region",
        statement: "Acme refers to Acme UK.",
        resolvedCandidateId: uk.candidateId,
        evidence: [
          "Acme UK is the nearest upcoming tagged candidate on the configured demo date.",
          "Acme US remains visible as the later alternative.",
        ],
        confidence: 0.82,
      },
    ],
    actions,
    accountBriefContentHash: artifact.desired.contentHash,
    executionOrder: [
      "initial.artifact.account_brief",
      "initial.calendar.move",
      "initial.mail.notify",
    ],
    modelMetadata: {
      provider: "fixture",
      model: "fixture-initial.v1",
      promptVersion: "fixture-initial.v1",
      responseId: "fixture-response",
    },
  });
  const digest = sha256Digest(planPayloadCore);
  const planPayload = InitialPlanPayloadSchema.parse({ ...planPayloadCore, digest });
  const plan = InitialPlanViewSchema.parse({
    pointer: { planId, kind: "initial", version: 1, digest },
    selectedCandidate: uk,
    alternatives: [us],
    assumptions: planPayload.assumptions,
    actions,
  });
  const timeline: TimelineItem[] = [
    {
      eventId: createOpaqueId("evt_"),
      type: "task.created",
      occurredAt,
      label: "World PR created",
      status: "preview_ready",
    },
    {
      eventId: createOpaqueId("evt_"),
      type: "plan.persisted",
      occurredAt,
      label: "Complete fixture-backed plan persisted",
      status: "preview_ready",
    },
  ];
  const view = WorldPrViewSchema.parse({
    worldPrId,
    runId,
    request,
    status: "preview_ready",
    activePlan: plan,
    timeline,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
  return { view, planPayload };
}

export function buildFixtureWorldPr(request: string, now = new Date()): WorldPrView {
  return buildFixtureWorldPrRecord(request, now).view;
}
