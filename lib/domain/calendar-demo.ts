import { z } from "zod";
import {
  CalendarEventSnapshotSchema,
  type CalendarEventCreate,
  type CalendarEventSnapshot,
} from "@/lib/contracts/provider-ports";
import {
  CalendarSemanticBaselineSchema,
  Rfc3339Schema,
  type CalendarSemanticBaseline,
} from "@/lib/contracts/v1";
import {
  CONTROLLED_CALENDAR_CANDIDATE_IDS,
  ControlledCalendarCandidateIdSchema,
  type ControlledCalendarCandidateId,
  type DemoEventState,
} from "@/lib/contracts/calendar-demo";
import { canonicalJson, sha256Digest, sha256Text } from "@/lib/domain/digest";
import { CONTROLLED_CANDIDATE_TITLES } from "@/lib/domain/scenario";

export const DEMO_CALENDAR_TIME_ZONE = "America/New_York" as const;
export const DEMO_CALENDAR_TAG = "acme-renewal" as const;
export const DEMO_CALENDAR_DURATION_MINUTES = 30 as const;

const demoLocalStartMinutes: Readonly<Record<"UK" | "US", number>> = { UK: 10 * 60, US: 11 * 60 };

export type CalendarDemoConfiguration = Readonly<{
  calendarId: string;
  demoDate: string;
  expectedEmail: string;
  recipients: Readonly<{ UK: readonly [string]; US: readonly [string] }>;
}>;

export type CalendarDemoCandidateState = Readonly<{
  candidateId: ControlledCalendarCandidateId;
  semanticBaseline: CalendarSemanticBaseline;
  expectedEtag: string;
  expectedUpdatedAt: string | null;
}>;

export type CalendarDemoErrorKind =
  | "invalid_configuration"
  | "invalid_provider_snapshot"
  | "candidate_count"
  | "candidate_mismatch"
  | "state_count"
  | "state_mismatch";

export class CalendarDemoValidationError extends Error {
  readonly kind: CalendarDemoErrorKind;

  constructor(kind: CalendarDemoErrorKind) {
    super("Controlled Calendar demo validation failed safely.");
    this.name = "CalendarDemoValidationError";
    this.kind = kind;
  }
}

function parseConfiguration(configuration: CalendarDemoConfiguration): CalendarDemoConfiguration {
  const email = z.string().email().safeParse(configuration.expectedEmail);
  const recipientEmails = [configuration.recipients.UK[0], configuration.recipients.US[0]];
  const parsedRecipients = recipientEmails.map((value) => z.string().email().safeParse(value));
  if (
    !configuration.calendarId ||
    configuration.calendarId.trim() !== configuration.calendarId ||
    configuration.calendarId === "primary" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(configuration.demoDate) ||
    configuration.demoDate !== "2026-08-20" ||
    !email.success ||
    parsedRecipients.some((parsed) => !parsed.success) ||
    new Set(recipientEmails.map((value) => value.toLowerCase())).size !== recipientEmails.length ||
    recipientEmails.some((value) => value.toLowerCase() === configuration.expectedEmail.toLowerCase())
  ) {
    throw new CalendarDemoValidationError("invalid_configuration");
  }
  return {
    ...configuration,
    expectedEmail: email.data.toLowerCase(),
    recipients: {
      UK: [parsedRecipients[0].data!.toLowerCase()],
      US: [parsedRecipients[1].data!.toLowerCase()],
    },
  };
}

function localDateParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new CalendarDemoValidationError("invalid_configuration");
  }
  return { year, month, day };
}

function zonedInstant(date: string, minutesFromMidnight: number): string {
  const { year, month, day } = localDateParts(date);
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute);
  const parts: Record<string, number> = {};
  try {
    for (const part of new Intl.DateTimeFormat("en-US", {
      timeZone: DEMO_CALENDAR_TIME_ZONE,
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
    throw new CalendarDemoValidationError("invalid_configuration");
  }
  const displayedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(nominalUtc - (displayedAsUtc - nominalUtc)).toISOString();
}

function expectedStartEnd(date: string, region: "UK" | "US"): { start: string; end: string } {
  const start = zonedInstant(date, demoLocalStartMinutes[region]);
  const end = new Date(Date.parse(start) + DEMO_CALENDAR_DURATION_MINUTES * 60_000).toISOString();
  return { start, end };
}

function candidateForRegion(region: "UK" | "US"): ControlledCalendarCandidateId {
  return region === "UK" ? CONTROLLED_CALENDAR_CANDIDATE_IDS[0] : CONTROLLED_CALENDAR_CANDIDATE_IDS[1];
}

function titleForRegion(region: "UK" | "US"): string {
  return region === "UK" ? CONTROLLED_CANDIDATE_TITLES[0] : CONTROLLED_CANDIDATE_TITLES[1];
}

function regionForCandidate(candidateId: ControlledCalendarCandidateId): "UK" | "US" {
  ControlledCalendarCandidateIdSchema.parse(candidateId);
  return candidateId.endsWith("_uk") ? "UK" : "US";
}

export function buildControlledCalendarSeeds(configuration: CalendarDemoConfiguration): readonly CalendarEventCreate[] {
  const parsed = parseConfiguration(configuration);
  return (["UK", "US"] as const).map((region) => {
    const times = expectedStartEnd(parsed.demoDate, region);
    return {
      calendarId: parsed.calendarId,
      title: titleForRegion(region),
      company: "Acme" as const,
      region,
      start: { instant: times.start, timeZone: DEMO_CALENDAR_TIME_ZONE },
      end: { instant: times.end, timeZone: DEMO_CALENDAR_TIME_ZONE },
      attendeeEmails: [parsed.recipients[region][0]],
      privateTags: { rewind_demo: DEMO_CALENDAR_TAG, region },
      sendUpdates: "none" as const,
    } satisfies CalendarEventCreate;
  });
}

function semanticBaseline(snapshot: CalendarEventSnapshot): CalendarSemanticBaseline {
  const durationMs = Date.parse(snapshot.end.instant) - Date.parse(snapshot.start.instant);
  if (durationMs !== DEMO_CALENDAR_DURATION_MINUTES * 60_000) throw new CalendarDemoValidationError("candidate_mismatch");
  try {
    return CalendarSemanticBaselineSchema.parse({
      calendarId: snapshot.calendarId,
      providerEventId: snapshot.providerEventId,
      start: snapshot.start,
      end: snapshot.end,
      durationMinutes: DEMO_CALENDAR_DURATION_MINUTES,
      organizerDigest: snapshot.organizerDigest,
      attendeeSetDigest: snapshot.attendeeSetDigest,
      eventType: snapshot.eventType,
      recurringEventId: snapshot.recurringEventId,
      privateTags: snapshot.privateTags,
    });
  } catch {
    throw new CalendarDemoValidationError("invalid_provider_snapshot");
  }
}

function validateSnapshotForRegion(
  rawSnapshot: CalendarEventSnapshot,
  configuration: CalendarDemoConfiguration,
  region: "UK" | "US",
): CalendarDemoCandidateState {
  const parsed = parseConfiguration(configuration);
  let snapshot: CalendarEventSnapshot;
  try {
    snapshot = CalendarEventSnapshotSchema.parse(rawSnapshot);
  } catch {
    throw new CalendarDemoValidationError("invalid_provider_snapshot");
  }
  validateControlledCalendarEventMetadata(snapshot, parsed, region);
  const expectedTimes = expectedStartEnd(parsed.demoDate, region);
  if (
    snapshot.start.instant !== expectedTimes.start ||
    snapshot.start.timeZone !== DEMO_CALENDAR_TIME_ZONE ||
    snapshot.end.instant !== expectedTimes.end ||
    snapshot.end.timeZone !== DEMO_CALENDAR_TIME_ZONE
  ) {
    throw new CalendarDemoValidationError("candidate_mismatch");
  }
  return {
    candidateId: candidateForRegion(region),
    semanticBaseline: semanticBaseline(snapshot),
    expectedEtag: snapshot.etag,
    expectedUpdatedAt: Rfc3339Schema.parse(snapshot.providerUpdated),
  };
}

/**
 * Validate the immutable controlled-event boundary without requiring the
 * event to still be at its seeded time. Calendar move/restore operations use
 * this check before and after a narrow start/end patch.
 */
export function validateControlledCalendarEventMetadata(
  rawSnapshot: CalendarEventSnapshot,
  configuration: CalendarDemoConfiguration,
  region: "UK" | "US",
): CalendarEventSnapshot {
  const parsed = parseConfiguration(configuration);
  let snapshot: CalendarEventSnapshot;
  try {
    snapshot = CalendarEventSnapshotSchema.parse(rawSnapshot);
  } catch {
    throw new CalendarDemoValidationError("invalid_provider_snapshot");
  }
  const expectedAttendeeDigest = sha256Digest([parsed.recipients[region][0]]);
  if (
    snapshot.calendarId !== parsed.calendarId ||
    snapshot.title !== titleForRegion(region) ||
    snapshot.company !== "Acme" ||
    snapshot.region !== region ||
    snapshot.organizerDigest !== sha256Text(parsed.expectedEmail) ||
    snapshot.attendeeSetDigest !== expectedAttendeeDigest ||
    snapshot.eventType !== "default" ||
    snapshot.recurringEventId !== null ||
    snapshot.ownedByConnectedAccount !== true ||
    canonicalJson(snapshot.privateTags) !== canonicalJson({ rewind_demo: DEMO_CALENDAR_TAG, region })
  ) {
    throw new CalendarDemoValidationError("candidate_mismatch");
  }
  return snapshot;
}

export function validateControlledCalendarEvent(
  snapshot: CalendarEventSnapshot,
  configuration: CalendarDemoConfiguration,
  region: "UK" | "US",
): CalendarDemoCandidateState {
  return validateSnapshotForRegion(snapshot, configuration, region);
}

export function validateControlledCalendarEvents(
  rawSnapshots: readonly CalendarEventSnapshot[],
  configuration: CalendarDemoConfiguration,
): readonly CalendarDemoCandidateState[] {
  parseConfiguration(configuration);
  if (rawSnapshots.length !== 2) throw new CalendarDemoValidationError("candidate_count");
  const byRegion = new Map<"UK" | "US", CalendarEventSnapshot>();
  const providerIds = new Set<string>();
  for (const rawSnapshot of rawSnapshots) {
    let snapshot: CalendarEventSnapshot;
    try {
      snapshot = CalendarEventSnapshotSchema.parse(rawSnapshot);
    } catch {
      throw new CalendarDemoValidationError("invalid_provider_snapshot");
    }
    if (byRegion.has(snapshot.region) || providerIds.has(snapshot.providerEventId)) {
      throw new CalendarDemoValidationError("candidate_count");
    }
    byRegion.set(snapshot.region, snapshot);
    providerIds.add(snapshot.providerEventId);
  }
  if (!byRegion.has("UK") || !byRegion.has("US")) throw new CalendarDemoValidationError("candidate_count");
  return (["UK", "US"] as const).map((region) => validateSnapshotForRegion(byRegion.get(region)!, configuration, region));
}

export function buildSeededDemoEventState(candidate: CalendarDemoCandidateState, runId: string): DemoEventState {
  return {
    ...candidate,
    lastReceipt: { operation: "seed", runId, status: "succeeded" },
  };
}

export function validateSeededState(
  rawSnapshots: readonly CalendarEventSnapshot[],
  storedStates: readonly DemoEventState[],
  configuration: CalendarDemoConfiguration,
): readonly DemoEventState[] {
  if (storedStates.length !== 2) throw new CalendarDemoValidationError("state_count");
  const expectedStates = validateControlledCalendarEvents(rawSnapshots, configuration);
  const storedByCandidate = new Map(storedStates.map((state) => [state.candidateId, state]));
  if (storedByCandidate.size !== 2) throw new CalendarDemoValidationError("state_count");
  for (const expected of expectedStates) {
    const stored = storedByCandidate.get(expected.candidateId);
    if (
      !stored ||
      canonicalJson(stored.semanticBaseline) !== canonicalJson(expected.semanticBaseline) ||
      stored.expectedEtag !== expected.expectedEtag ||
      stored.expectedUpdatedAt !== expected.expectedUpdatedAt
    ) {
      throw new CalendarDemoValidationError("state_mismatch");
    }
  }
  return storedStates;
}

export function candidateRegion(candidateId: ControlledCalendarCandidateId): "UK" | "US" {
  return regionForCandidate(candidateId);
}
