import { describe, expect, it } from "vitest";
import { FakeModelPort, ModelProviderError } from "@/lib/ai/model";
import { ArtifactProviderError, FakeArtifactPort } from "@/lib/adapters/artifact";
import { CalendarProviderError, FakeCalendarPort } from "@/lib/adapters/calendar";
import { FakeGmailPort, GmailProviderError } from "@/lib/adapters/gmail";
import {
  ACCOUNT_BRIEF_CONTENT_FIXTURE,
  ACCOUNT_BRIEF_SOURCE_ID,
  ACCOUNT_BRIEF_TITLE,
  ACCOUNT_BRIEF_VALIDATOR_VERSION,
  CONTROLLED_CONTENT_VERSION,
  PARENT_ACCOUNT_NOTES_FIXTURE,
} from "@/lib/domain/account-brief";
import { sha256Text } from "@/lib/domain/digest";
import { PROVIDER_PORTS_CONTRACT_VERSION } from "@/lib/contracts/provider-ports";
import type { AccountBriefArtifactInput, CalendarEventSnapshot, RecoveryModelInput } from "@/lib/contracts/provider-ports";

const calendarId = "fake-demo-calendar";
const calendarEvents: readonly CalendarEventSnapshot[] = [
  {
    calendarId,
    providerEventId: "fixture-event-us",
    title: "Acme US renewal",
    company: "Acme",
    region: "US",
    start: { instant: "2026-08-20T15:00:00.000Z", timeZone: "America/New_York" },
    end: { instant: "2026-08-20T15:30:00.000Z", timeZone: "America/New_York" },
    etag: "fixture-us-etag-v1",
    providerUpdated: "2026-07-16T00:00:00.000Z",
    organizerDigest: sha256Text("fixture-organizer-us-v1"),
    attendeeSetDigest: sha256Text("fixture-attendees-us-v1"),
    eventType: "default",
    recurringEventId: null,
    ownedByConnectedAccount: true,
    privateTags: { rewind_demo: "acme-renewal", region: "US" },
  },
  {
    calendarId,
    providerEventId: "fixture-event-uk",
    title: "Acme UK renewal",
    company: "Acme",
    region: "UK",
    start: { instant: "2026-08-20T14:00:00.000Z", timeZone: "America/New_York" },
    end: { instant: "2026-08-20T14:30:00.000Z", timeZone: "America/New_York" },
    etag: "fixture-uk-etag-v1",
    providerUpdated: "2026-07-16T00:00:00.000Z",
    organizerDigest: sha256Text("fixture-organizer-uk-v1"),
    attendeeSetDigest: sha256Text("fixture-attendees-uk-v1"),
    eventType: "default",
    recurringEventId: null,
    ownedByConnectedAccount: true,
    privateTags: { rewind_demo: "acme-renewal", region: "UK" },
  },
];

const approvedMessage = {
  senderGoogleSub: "fixture-google-subject",
  to: ["team-uk@example.test"],
  subject: "[Rewind fixture-run] Approved notice",
  bodyText: "Synthetic approved body.",
  bodyHash: sha256Text("Synthetic approved body."),
  runId: "fixture-run-001",
};

const artifact = {
  title: ACCOUNT_BRIEF_TITLE,
  content: ACCOUNT_BRIEF_CONTENT_FIXTURE,
  contentHash: sha256Text(ACCOUNT_BRIEF_CONTENT_FIXTURE),
  provenance: {
    sourceId: ACCOUNT_BRIEF_SOURCE_ID,
    sourceVersion: CONTROLLED_CONTENT_VERSION,
    sourceDigest: sha256Text(PARENT_ACCOUNT_NOTES_FIXTURE),
    excludedDimensions: ["calendar_event", "region", "attendees", "meeting_time"] as const,
    validatorVersion: ACCOUNT_BRIEF_VALIDATOR_VERSION,
  },
} satisfies AccountBriefArtifactInput;

const initialInput = {
  request: "Synthetic Acme request",
  candidateEvidence: ["Synthetic candidate evidence one", "Synthetic candidate evidence two"],
  allowedCandidateIds: ["fixture-event-uk", "fixture-event-us"],
  allowedActionKeys: ["initial.calendar.move", "initial.mail.notify"],
};

const recoveryInput = {
  lateContext: "Synthetic corrected context",
  completedActionIds: ["fixture-action-uk"],
  allowedOutcomes: ["restore", "correct", "preserve", "apply"],
  allowedActionKeys: ["recovery.calendar.restore_uk", "recovery.mail.correct_uk"],
} satisfies RecoveryModelInput;

const preventionRuleInput = {
  sourceTaskId: "fixture-task-001",
  candidateIds: ["fixture-event-uk", "fixture-event-us"],
  ruleType: "calendar_company_region_ambiguity" as const,
  allowedAction: "ask_for_confirmation" as const,
};

describe("explicit provider ports and deterministic fakes", () => {
  it("lists controlled Calendar events and conditionally updates only start/end", async () => {
    expect(PROVIDER_PORTS_CONTRACT_VERSION).toBe("provider-ports.v1");
    const calendar = new FakeCalendarPort({ events: calendarEvents });
    const candidates = await calendar.listControlledEvents({ calendarId, tag: "acme-renewal" });
    expect(candidates.map((event) => event.providerEventId)).toEqual(["fixture-event-uk", "fixture-event-us"]);

    const before = await calendar.getControlledEvent({ calendarId, providerEventId: "fixture-event-uk" });
    const after = await calendar.updateStartEnd({
      calendarId,
      providerEventId: before.providerEventId,
      expectedEtag: before.etag,
      start: { instant: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" },
      end: { instant: "2026-08-20T19:30:00.000Z", timeZone: "America/New_York" },
      sendUpdates: "none",
    });

    expect(after.start.instant).toBe("2026-08-20T19:00:00.000Z");
    expect(after.end.instant).toBe("2026-08-20T19:30:00.000Z");
    expect(after.title).toBe(before.title);
    expect(after.attendeeSetDigest).toBe(before.attendeeSetDigest);
    expect(after.etag).toBe("fake-calendar-etag-1");
    await expect(calendar.getControlledEvent({ calendarId, providerEventId: before.providerEventId })).resolves.toMatchObject({
      etag: "fake-calendar-etag-1",
      start: after.start,
      end: after.end,
    });
  });

  it("injects Calendar unavailability and conflicts without rebasing", async () => {
    const unavailable = new FakeCalendarPort({ events: calendarEvents, failure: { operation: "list", kind: "unavailable" } });
    await expect(unavailable.listControlledEvents({ calendarId, tag: "acme-renewal" })).rejects.toMatchObject({
      kind: "unavailable",
    });

    const conflict = new FakeCalendarPort({ events: calendarEvents, failure: { operation: "update", kind: "conflict" } });
    const before = await conflict.getControlledEvent({ calendarId, providerEventId: "fixture-event-uk" });
    await expect(
      conflict.updateStartEnd({
        calendarId,
        providerEventId: before.providerEventId,
        expectedEtag: before.etag,
        start: before.start,
        end: before.end,
        sendUpdates: "none",
      }),
    ).rejects.toBeInstanceOf(CalendarProviderError);
    await expect(conflict.getControlledEvent({ calendarId, providerEventId: before.providerEventId })).resolves.toMatchObject({
      etag: before.etag,
      start: before.start,
      end: before.end,
    });
  });

  it("models Gmail success, local failure, permanent failure, and uncertainty without retry", async () => {
    const success = new FakeGmailPort();
    await expect(success.sendApprovedMessage(approvedMessage)).resolves.toMatchObject({ status: "sent" });
    expect(success.getAttemptCount()).toBe(1);

    const localFailure = new FakeGmailPort({ failure: { kind: "local_failure" } });
    await expect(localFailure.sendApprovedMessage(approvedMessage)).rejects.toBeInstanceOf(GmailProviderError);
    expect(localFailure.getAttemptCount()).toBe(1);

    const permanentFailure = new FakeGmailPort({ failure: { kind: "permanent_failure" } });
    await expect(permanentFailure.sendApprovedMessage(approvedMessage)).resolves.toMatchObject({
      status: "permanent_failed",
      providerCode: "fake_4xx",
    });
    expect(permanentFailure.getAttemptCount()).toBe(1);

    const uncertain = new FakeGmailPort({ failure: { kind: "delivery_uncertain" } });
    await expect(uncertain.sendApprovedMessage(approvedMessage)).resolves.toMatchObject({
      status: "delivery_uncertain",
      reason: "transport_timeout",
    });
    expect(uncertain.getAttemptCount()).toBe(1);
  });

  it("persists the exact approved artifact bytes and injects storage failure", async () => {
    const store = new FakeArtifactPort();
    const receipt = await store.persistApprovedAccountBrief(artifact);
    expect(receipt).toMatchObject({ artifactId: "fake-artifact-account-brief-v1", contentHash: artifact.contentHash });
    expect(store.getSavedForTest()).toEqual(artifact);

    const invalid = { ...artifact, contentHash: sha256Text("different content") };
    await expect(store.persistApprovedAccountBrief(invalid)).rejects.toMatchObject({ kind: "validation_failure" });
    const unavailable = new FakeArtifactPort({ failure: "unavailable" });
    await expect(unavailable.persistApprovedAccountBrief(artifact)).rejects.toBeInstanceOf(ArtifactProviderError);
  });

  it("keeps model operations explicit, raw output untrusted, and failures injectable", async () => {
    const model = new FakeModelPort({
      outputs: {
        initial: { proposal: "initial" },
        recovery: { proposal: "recovery" },
        prevention_rule: "unvalidated fixture output",
      },
    });
    await expect(model.proposeInitial(initialInput)).resolves.toMatchObject({ kind: "initial", rawOutput: { proposal: "initial" } });
    await expect(model.proposeRecovery(recoveryInput)).resolves.toMatchObject({ kind: "recovery", rawOutput: { proposal: "recovery" } });
    await expect(model.proposePreventionRule(preventionRuleInput)).resolves.toMatchObject({
      kind: "prevention_rule",
      rawOutput: "unvalidated fixture output",
    });
    expect(model.getCalls()).toEqual(["initial", "recovery", "prevention_rule"]);

    const refusal = new FakeModelPort({
      outputs: { initial: { proposal: "never used" } },
      failures: [{ operation: "initial", kind: "refusal" }],
    });
    await expect(refusal.proposeInitial(initialInput)).rejects.toBeInstanceOf(ModelProviderError);

    const invalidInput = { ...initialInput, unexpected: true } as typeof initialInput;
    await expect(model.proposeInitial(invalidInput)).rejects.toThrow();
    expect(model.getCalls()).toEqual(["initial", "recovery", "prevention_rule"]);
  });
});
