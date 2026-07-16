import { z } from "zod";
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
import { Rfc3339Schema } from "@/lib/contracts/v1";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";
import { CalendarProviderError, type CalendarPort } from "@/lib/adapters/calendar";

export const GOOGLE_CALENDAR_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars" as const;

const GoogleEventTimeSchema = z
  .object({ dateTime: z.string().min(1).max(100), timeZone: z.string().min(1).max(100) })
  .strict();

const GoogleEventSchema = z
  .object({
    id: z.string().min(1).max(512),
    summary: z.string().min(1).max(200),
    start: GoogleEventTimeSchema,
    end: GoogleEventTimeSchema,
    etag: z.string().min(1).max(200),
    updated: Rfc3339Schema,
    organizer: z.object({ email: z.string().email().max(320) }).strict(),
    attendees: z.array(z.object({ email: z.string().email().max(320) }).strict()).optional(),
    eventType: z.literal("default"),
    recurringEventId: z.string().min(1).max(512).optional(),
    recurrence: z.array(z.string().min(1).max(1000)).optional(),
    extendedProperties: z
      .object({ private: z.record(z.string().min(1).max(200)) })
      .strict(),
  })
  .strict();

const GoogleEventListSchema = z
  .object({
    items: z.array(GoogleEventSchema),
    nextPageToken: z.string().min(1).max(512).optional(),
  })
  .strict();

type GoogleCalendarPortOptions = Readonly<{
  accessToken: string;
  calendarId: string;
  expectedEmail: string;
  fetchImpl?: typeof fetch;
}>;

// `events.list` returns a collection, while `events.get`, `insert`, and
// `patch` each return an Event resource. Keep their partial-response
// projections distinct: collection-only `items(...)` is invalid on an Event
// resource and Google rejects it with HTTP 400.
const CALENDAR_EVENT_FIELDS = [
  "id",
  "summary",
  "start(dateTime,timeZone)",
  "end(dateTime,timeZone)",
  "etag",
  "updated",
  "organizer(email)",
  "attendees(email)",
  "eventType",
  "recurringEventId",
  "recurrence",
  "extendedProperties(private)",
].join(",");

const CALENDAR_LIST_FIELDS = `items(${CALENDAR_EVENT_FIELDS}),nextPageToken`;

function copyHeaders(headers: HeadersInit | undefined, accessToken: string): Headers {
  const result = new Headers(headers);
  result.set("accept", "application/json");
  result.set("authorization", `Bearer ${accessToken}`);
  return result;
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeInstant(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new CalendarProviderError("unavailable");
  return parsed.toISOString();
}

function calendarUrl(calendarId: string, providerEventId?: string): URL {
  const suffix = providerEventId ? `/events/${encodeURIComponent(providerEventId)}` : "/events";
  return new URL(`${GOOGLE_CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}${suffix}`);
}

function assertConfiguredCalendar(calendarId: string, configuredCalendarId: string): void {
  if (calendarId !== configuredCalendarId) throw new CalendarProviderError("not_found");
}

function mapGoogleEvent(raw: unknown, expectedEmail: string, calendarId: string): CalendarEventSnapshot {
  const parsed = GoogleEventSchema.safeParse(raw);
  if (!parsed.success) throw new CalendarProviderError("unavailable");
  if (parsed.data.recurringEventId || parsed.data.recurrence?.length) throw new CalendarProviderError("unavailable");
  if (!isIanaTimeZone(parsed.data.start.timeZone) || parsed.data.start.timeZone !== parsed.data.end.timeZone) {
    throw new CalendarProviderError("unavailable");
  }

  const organizerEmail = parsed.data.organizer.email.toLowerCase();
  const attendeeEmails = (parsed.data.attendees ?? []).map((attendee) => attendee.email.toLowerCase()).sort();
  if (new Set(attendeeEmails).size !== attendeeEmails.length) throw new CalendarProviderError("unavailable");
  const privateTags = parsed.data.extendedProperties.private;
  const company = "Acme" as const;
  const region = privateTags.region === "UK" || privateTags.region === "US" ? privateTags.region : undefined;
  if (
    !region ||
    privateTags.rewind_demo !== "acme-renewal" ||
    JSON.stringify(Object.keys(privateTags).sort()) !== JSON.stringify(["region", "rewind_demo"])
  ) {
    throw new CalendarProviderError("unavailable");
  }

  try {
    return CalendarEventSnapshotSchema.parse({
      calendarId,
      providerEventId: parsed.data.id,
      title: parsed.data.summary,
      company,
      region,
      start: { instant: normalizeInstant(parsed.data.start.dateTime), timeZone: parsed.data.start.timeZone },
      end: { instant: normalizeInstant(parsed.data.end.dateTime), timeZone: parsed.data.end.timeZone },
      etag: parsed.data.etag,
      providerUpdated: parsed.data.updated,
      organizerDigest: sha256Text(organizerEmail),
      attendeeSetDigest: sha256Digest(attendeeEmails),
      eventType: parsed.data.eventType,
      recurringEventId: null,
      ownedByConnectedAccount: sha256Text(organizerEmail) === sha256Text(expectedEmail.toLowerCase()),
      privateTags: { rewind_demo: "acme-renewal", region },
    });
  } catch {
    throw new CalendarProviderError("unavailable");
  }
}

/**
 * Google Calendar's wire adapter. It emits only the narrow typed snapshot used
 * by the controlled Acme scenario; raw provider responses never cross this
 * boundary or appear in command output.
 */
export class GoogleCalendarPort implements CalendarPort {
  private readonly accessToken: string;
  private readonly calendarId: string;
  private readonly expectedEmail: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleCalendarPortOptions) {
    if (!options.accessToken || /\s/.test(options.accessToken)) throw new Error("Google Calendar access token is invalid.");
    if (!options.calendarId || options.calendarId.trim() !== options.calendarId || options.calendarId === "primary") {
      throw new Error("Google Calendar target must be an explicit configured calendar ID.");
    }
    const expectedEmail = z.string().email().safeParse(options.expectedEmail);
    if (!expectedEmail.success) throw new Error("Google Calendar owner email is invalid.");
    this.accessToken = options.accessToken;
    this.calendarId = options.calendarId;
    this.expectedEmail = expectedEmail.data.toLowerCase();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listControlledEvents(input: CalendarCandidateQuery): Promise<readonly CalendarEventSnapshot[]> {
    const parsed = CalendarCandidateQuerySchema.parse(input);
    assertConfiguredCalendar(parsed.calendarId, this.calendarId);
    const snapshots: CalendarEventSnapshot[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const url = calendarUrl(this.calendarId);
      url.searchParams.set("privateExtendedProperty", `rewind_demo=${parsed.tag}`);
      url.searchParams.set("showDeleted", "false");
      url.searchParams.set("maxResults", "2500");
      url.searchParams.set("fields", CALENDAR_LIST_FIELDS);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = await this.requestJson(url, { method: "GET" });
      const response = GoogleEventListSchema.safeParse(body);
      if (!response.success) throw new CalendarProviderError("unavailable");
      for (const event of response.data.items) {
        snapshots.push(mapGoogleEvent(event, this.expectedEmail, this.calendarId));
      }
      if (!response.data.nextPageToken) return snapshots;
      pageToken = response.data.nextPageToken;
    }
    throw new CalendarProviderError("unavailable");
  }

  async getControlledEvent(input: CalendarEventReference): Promise<CalendarEventSnapshot> {
    const parsed = CalendarEventReferenceSchema.parse(input);
    assertConfiguredCalendar(parsed.calendarId, this.calendarId);
    const url = calendarUrl(this.calendarId, parsed.providerEventId);
    url.searchParams.set("fields", CALENDAR_EVENT_FIELDS);
    const body = await this.requestJson(url, { method: "GET" });
    return mapGoogleEvent(body, this.expectedEmail, this.calendarId);
  }

  async createControlledEvent(input: CalendarEventCreate): Promise<CalendarEventSnapshot> {
    const parsed = CalendarEventCreateSchema.parse(input);
    assertConfiguredCalendar(parsed.calendarId, this.calendarId);
    const url = calendarUrl(this.calendarId);
    url.searchParams.set("sendUpdates", parsed.sendUpdates);
    url.searchParams.set("fields", CALENDAR_EVENT_FIELDS);
    const body = await this.requestJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summary: parsed.title,
        start: { dateTime: parsed.start.instant, timeZone: parsed.start.timeZone },
        end: { dateTime: parsed.end.instant, timeZone: parsed.end.timeZone },
        attendees: parsed.attendeeEmails.map((email) => ({ email: email.toLowerCase() })),
        extendedProperties: { private: parsed.privateTags },
      }),
    });
    return mapGoogleEvent(body, this.expectedEmail, this.calendarId);
  }

  async updateStartEnd(input: CalendarConditionalTimeUpdate): Promise<CalendarEventSnapshot> {
    const parsed = CalendarConditionalTimeUpdateSchema.parse(input);
    assertConfiguredCalendar(parsed.calendarId, this.calendarId);
    const url = calendarUrl(this.calendarId, parsed.providerEventId);
    url.searchParams.set("sendUpdates", parsed.sendUpdates);
    url.searchParams.set("fields", CALENDAR_EVENT_FIELDS);
    const body = await this.requestJson(url, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": parsed.expectedEtag,
      },
      body: JSON.stringify({
        start: { dateTime: parsed.start.instant, timeZone: parsed.start.timeZone },
        end: { dateTime: parsed.end.instant, timeZone: parsed.end.timeZone },
      }),
    });
    return mapGoogleEvent(body, this.expectedEmail, this.calendarId);
  }

  private async requestJson(url: URL, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: copyHeaders(init.headers, this.accessToken),
        redirect: "error",
      });
    } catch {
      throw new CalendarProviderError("unavailable");
    }
    if (!response.ok) {
      if (response.status === 404) throw new CalendarProviderError("not_found");
      if (response.status === 412) throw new CalendarProviderError("conflict");
      throw new CalendarProviderError("unavailable");
    }
    try {
      return await response.json();
    } catch {
      throw new CalendarProviderError("unavailable");
    }
  }
}
