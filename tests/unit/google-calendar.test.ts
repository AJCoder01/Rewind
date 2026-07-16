import { describe, expect, it } from "vitest";
import { CalendarProviderError } from "@/lib/adapters/calendar";
import { GoogleCalendarPort } from "@/lib/google/calendar";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";

const calendarId = "demo-calendar-2026";

function googleEvent(region: "UK" | "US", providerEventId = `google-event-${region.toLowerCase()}`): Record<string, unknown> {
  const start = region === "UK" ? "2026-08-20T10:00:00-04:00" : "2026-08-20T11:00:00-04:00";
  const end = region === "UK" ? "2026-08-20T10:30:00-04:00" : "2026-08-20T11:30:00-04:00";
  return {
    id: providerEventId,
    summary: `Acme ${region} renewal`,
    start: { dateTime: start, timeZone: "America/New_York" },
    end: { dateTime: end, timeZone: "America/New_York" },
    etag: `"etag-${region}"`,
    updated: "2026-07-16T00:00:00.000Z",
    organizer: { email: "owner@example.com" },
    attendees: [{ email: `${region.toLowerCase()}-team@example.com` }],
    eventType: "default",
    extendedProperties: { private: { rewind_demo: "acme-renewal", region } },
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Google Calendar wire adapter", () => {
  it("maps only a typed owned event snapshot and sends the configured bearer token", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const calendar = new GoogleCalendarPort({
      accessToken: "access-token-value",
      calendarId,
      expectedEmail: "owner@example.com",
      fetchImpl: async (input, init) => {
        requests.push({ input, init });
        return response({ items: [googleEvent("UK")] });
      },
    });
    const [event] = await calendar.listControlledEvents({ calendarId, tag: "acme-renewal" });
    expect(event).toMatchObject({
      calendarId,
      providerEventId: "google-event-uk",
      start: { instant: "2026-08-20T14:00:00.000Z", timeZone: "America/New_York" },
      end: { instant: "2026-08-20T14:30:00.000Z", timeZone: "America/New_York" },
      ownedByConnectedAccount: true,
      attendeeSetDigest: sha256Digest(["uk-team@example.com"]),
      organizerDigest: sha256Text("owner@example.com"),
    });
    const request = requests[0];
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer access-token-value");
    const url = new URL(String(request.input));
    expect(url.searchParams.get("privateExtendedProperty")).toBe("rewind_demo=acme-renewal");
    expect(url.searchParams.get("showDeleted")).toBe("false");
    expect(url.searchParams.get("fields")).toContain("items(");
    expect(url.searchParams.get("fields")).toContain("nextPageToken");
  });

  it("requests an Event projection, never a collection projection, for a single event", async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const calendar = new GoogleCalendarPort({
      accessToken: "access-token-value",
      calendarId,
      expectedEmail: "owner@example.com",
      fetchImpl: async (input, init) => {
        request = { input, init };
        return response(googleEvent("UK"));
      },
    });

    await calendar.getControlledEvent({ calendarId, providerEventId: "google-event-uk" });

    expect(request?.init?.method).toBe("GET");
    const fields = new URL(String(request?.input)).searchParams.get("fields");
    expect(fields).toContain("id");
    expect(fields).not.toContain("items(");
    expect(fields).not.toContain("nextPageToken");
  });

  it("creates with sendUpdates=none and only controlled fields", async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const calendar = new GoogleCalendarPort({
      accessToken: "access-token-value",
      calendarId,
      expectedEmail: "owner@example.com",
      fetchImpl: async (input, init) => {
        request = { input, init };
        return response(googleEvent("US"));
      },
    });
    await calendar.createControlledEvent({
      calendarId,
      title: "Acme US renewal",
      company: "Acme",
      region: "US",
      start: { instant: "2026-08-20T15:00:00.000Z", timeZone: "America/New_York" },
      end: { instant: "2026-08-20T15:30:00.000Z", timeZone: "America/New_York" },
      attendeeEmails: ["us-team@example.com"],
      privateTags: { rewind_demo: "acme-renewal", region: "US" },
      sendUpdates: "none",
    });
    expect(request?.init?.method).toBe("POST");
    const url = new URL(String(request?.input));
    expect(url.searchParams.get("sendUpdates")).toBe("none");
    expect(url.searchParams.get("fields")).not.toContain("items(");
    expect(url.searchParams.get("fields")).not.toContain("nextPageToken");
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      summary: "Acme US renewal",
      start: { dateTime: "2026-08-20T15:00:00.000Z", timeZone: "America/New_York" },
      end: { dateTime: "2026-08-20T15:30:00.000Z", timeZone: "America/New_York" },
      attendees: [{ email: "us-team@example.com" }],
      extendedProperties: { private: { rewind_demo: "acme-renewal", region: "US" } },
    });
  });

  it("rejects create inputs outside the fixed title, time-zone, and duration contract", async () => {
    const calendar = new GoogleCalendarPort({
      accessToken: "access-token-value",
      calendarId,
      expectedEmail: "owner@example.com",
      fetchImpl: async () => response(googleEvent("UK")),
    });
    await expect(calendar.createControlledEvent({
      calendarId,
      title: "Acme UK renewal",
      company: "Acme",
      region: "UK",
      start: { instant: "2026-08-20T14:00:00.000Z", timeZone: "UTC" },
      end: { instant: "2026-08-20T15:00:00.000Z", timeZone: "UTC" },
      attendeeEmails: ["uk-team@example.com"],
      privateTags: { rewind_demo: "acme-renewal", region: "UK" },
      sendUpdates: "none",
    })).rejects.toThrow();
  });

  it("uses If-Match for narrow start/end updates", async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const calendar = new GoogleCalendarPort({
      accessToken: "access-token-value",
      calendarId,
      expectedEmail: "owner@example.com",
      fetchImpl: async (input, init) => {
        request = { input, init };
        return response(googleEvent("UK"));
      },
    });
    await calendar.updateStartEnd({
      calendarId,
      providerEventId: "google-event-uk",
      expectedEtag: '"etag-UK"',
      start: { instant: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" },
      end: { instant: "2026-08-20T19:30:00.000Z", timeZone: "America/New_York" },
      sendUpdates: "none",
    });
    expect(request?.init?.method).toBe("PATCH");
    expect(new Headers(request?.init?.headers).get("if-match")).toBe('"etag-UK"');
    expect(new URL(String(request?.input)).searchParams.get("fields")).not.toContain("items(");
    expect(new URL(String(request?.input)).searchParams.get("fields")).not.toContain("nextPageToken");
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      start: { dateTime: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" },
      end: { dateTime: "2026-08-20T19:30:00.000Z", timeZone: "America/New_York" },
    });
  });

  it("fails closed for primary/unknown targets, recurring or malformed events, and stale writes", async () => {
    expect(() => new GoogleCalendarPort({ accessToken: "access-token", calendarId: "primary", expectedEmail: "owner@example.com" })).toThrow();
    const malformed = new GoogleCalendarPort({
      accessToken: "access-token-value",
      calendarId,
      expectedEmail: "owner@example.com",
      fetchImpl: async () => response({ items: [{ ...googleEvent("UK"), start: { date: "2026-08-20" } }] }),
    });
    await expect(malformed.listControlledEvents({ calendarId, tag: "acme-renewal" })).rejects.toMatchObject({ kind: "unavailable" });

    const stale = new GoogleCalendarPort({
      accessToken: "access-token-value",
      calendarId,
      expectedEmail: "owner@example.com",
      fetchImpl: async () => response({ error: "precondition" }, 412),
    });
    await expect(stale.updateStartEnd({
      calendarId,
      providerEventId: "google-event-uk",
      expectedEtag: '"old"',
      start: { instant: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" },
      end: { instant: "2026-08-20T19:30:00.000Z", timeZone: "America/New_York" },
      sendUpdates: "none",
    })).rejects.toBeInstanceOf(CalendarProviderError);
  });
});
