import {
  CalendarCandidateQuerySchema,
  CalendarConditionalTimeUpdateSchema,
  CalendarEventCreateSchema,
  CalendarEventReferenceSchema,
  CalendarEventSnapshotSchema,
  type CalendarCandidateQuery,
  type CalendarConditionalTimeUpdate,
  type CalendarEventCreate,
  type CalendarEventReference,
  type CalendarEventSnapshot,
} from "@/lib/contracts/provider-ports";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";

export type CalendarOperation = "list" | "get" | "create" | "update";
export type CalendarProviderErrorKind = "unavailable" | "not_found" | "conflict";

export class CalendarProviderError extends Error {
  readonly kind: CalendarProviderErrorKind;

  constructor(kind: CalendarProviderErrorKind) {
    super("Calendar provider operation failed safely.");
    this.name = "CalendarProviderError";
    this.kind = kind;
  }
}

export interface CalendarPort {
  listControlledEvents(input: CalendarCandidateQuery): Promise<readonly CalendarEventSnapshot[]>;
  getControlledEvent(input: CalendarEventReference): Promise<CalendarEventSnapshot>;
  createControlledEvent(input: CalendarEventCreate): Promise<CalendarEventSnapshot>;
  updateStartEnd(input: CalendarConditionalTimeUpdate): Promise<CalendarEventSnapshot>;
}

export type FakeCalendarFailure = Readonly<{
  operation: CalendarOperation;
  kind: CalendarProviderErrorKind;
}>;

export type FakeCalendarOptions = Readonly<{
  events: readonly CalendarEventSnapshot[];
  failure?: FakeCalendarFailure;
  etagPrefix?: string;
  organizerDigest?: string;
}>;

function copySnapshot(snapshot: CalendarEventSnapshot): CalendarEventSnapshot {
  return {
    ...snapshot,
    start: { ...snapshot.start },
    end: { ...snapshot.end },
    privateTags: { ...snapshot.privateTags },
  };
}

function eventKey(calendarId: string, providerEventId: string): string {
  return `${calendarId}\0${providerEventId}`;
}

/** Deterministic Calendar port used only by tests and the non-production fixture boundary. */
export class FakeCalendarPort implements CalendarPort {
  private readonly events = new Map<string, CalendarEventSnapshot>();
  private readonly failure?: FakeCalendarFailure;
  private readonly etagPrefix: string;
  private readonly organizerDigest: string;
  private writeCount = 0;

  constructor(options: FakeCalendarOptions) {
    this.failure = options.failure;
    this.etagPrefix = options.etagPrefix ?? "fake-calendar-etag";
    this.organizerDigest = options.organizerDigest ?? sha256Text("fake-calendar-organizer");
    for (const candidate of options.events) {
      const parsed = CalendarEventSnapshotSchema.parse(candidate);
      const key = eventKey(parsed.calendarId, parsed.providerEventId);
      if (this.events.has(key)) throw new Error("Fake Calendar event identifiers must be unique.");
      this.events.set(key, copySnapshot(parsed));
    }
  }

  async listControlledEvents(input: CalendarCandidateQuery): Promise<readonly CalendarEventSnapshot[]> {
    const parsed = CalendarCandidateQuerySchema.parse(input);
    this.failIfConfigured("list");
    return Array.from(this.events.values())
      .filter((event) => event.calendarId === parsed.calendarId && event.privateTags.rewind_demo === parsed.tag)
      .sort((left, right) => left.providerEventId.localeCompare(right.providerEventId))
      .map(copySnapshot);
  }

  async getControlledEvent(input: CalendarEventReference): Promise<CalendarEventSnapshot> {
    const parsed = CalendarEventReferenceSchema.parse(input);
    this.failIfConfigured("get");
    const event = this.events.get(eventKey(parsed.calendarId, parsed.providerEventId));
    if (!event) throw new CalendarProviderError("not_found");
    return copySnapshot(event);
  }

  async createControlledEvent(input: CalendarEventCreate): Promise<CalendarEventSnapshot> {
    const parsed = CalendarEventCreateSchema.parse(input);
    this.failIfConfigured("create");
    const providerEventId = `fake-seeded-event-${parsed.region.toLowerCase()}`;
    const key = eventKey(parsed.calendarId, providerEventId);
    if (this.events.has(key)) throw new CalendarProviderError("conflict");
    const snapshot = CalendarEventSnapshotSchema.parse({
      calendarId: parsed.calendarId,
      providerEventId,
      title: parsed.title,
      company: parsed.company,
      region: parsed.region,
      start: parsed.start,
      end: parsed.end,
      etag: `${this.etagPrefix}-create-${++this.writeCount}`,
      providerUpdated: new Date(Date.UTC(2026, 0, 1, 0, 0, this.writeCount)).toISOString(),
      organizerDigest: this.organizerDigest,
      attendeeSetDigest: sha256Digest(parsed.attendeeEmails.map((email) => email.toLowerCase()).sort()),
      eventType: "default",
      recurringEventId: null,
      ownedByConnectedAccount: true,
      privateTags: parsed.privateTags,
    });
    this.events.set(key, snapshot);
    return copySnapshot(snapshot);
  }

  async updateStartEnd(input: CalendarConditionalTimeUpdate): Promise<CalendarEventSnapshot> {
    const parsed = CalendarConditionalTimeUpdateSchema.parse(input);
    this.failIfConfigured("update");
    const key = eventKey(parsed.calendarId, parsed.providerEventId);
    const event = this.events.get(key);
    if (!event) throw new CalendarProviderError("not_found");
    if (event.etag !== parsed.expectedEtag) throw new CalendarProviderError("conflict");
    const next = CalendarEventSnapshotSchema.parse({
      ...event,
      start: parsed.start,
      end: parsed.end,
      etag: `${this.etagPrefix}-${++this.writeCount}`,
      providerUpdated: new Date(Date.UTC(2026, 0, 1, 0, 0, this.writeCount)).toISOString(),
    });
    this.events.set(key, next);
    return copySnapshot(next);
  }

  private failIfConfigured(operation: CalendarOperation): void {
    if (this.failure?.operation === operation) throw new CalendarProviderError(this.failure.kind);
  }
}
