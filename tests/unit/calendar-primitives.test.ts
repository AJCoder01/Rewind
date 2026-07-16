import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { FakeCalendarPort } from "@/lib/adapters/calendar";
import { CalendarOperationDesiredSchema } from "@/lib/contracts/calendar-demo";
import { buildControlledCalendarSeeds } from "@/lib/domain/calendar-demo";
import { sha256Text } from "@/lib/domain/digest";
import { MemoryDemoEventStateStore, PostgresDemoEventStateStore } from "@/lib/db/demo-event-state";
import { moveControlledCalendarEvent, restoreControlledCalendarEvent } from "@/lib/services/calendar-primitives";
import { preflightControlledCalendar, seedControlledCalendar } from "@/lib/services/calendar-demo";
import type { CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";

const configuration: CalendarDemoConfiguration = {
  calendarId: "demo-calendar-2026",
  demoDate: "2026-08-20",
  expectedEmail: "owner@example.com",
  recipients: { UK: ["uk-team@example.com"], US: ["us-team@example.com"] },
};

const movedDesired = CalendarOperationDesiredSchema.parse({
  start: { instant: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" },
  end: { instant: "2026-08-20T19:30:00.000Z", timeZone: "America/New_York" },
  durationMinutes: 30,
  sendUpdates: "none",
});

async function seededFixture(options: ConstructorParameters<typeof FakeCalendarPort>[0] = { events: [], organizerDigest: sha256Text(configuration.expectedEmail) }) {
  const calendar = new FakeCalendarPort(options);
  const state = new MemoryDemoEventStateStore();
  await seedControlledCalendar({ calendar, state, configuration, runId: "seed-primitive-001" });
  return { calendar, state };
}

describe("controlled Calendar move and restore primitives", () => {
  it("persists before/desired/after/receipt and rolls the expected provider version", async () => {
    const { calendar, state } = await seededFixture();
    const result = await moveControlledCalendarEvent({
      calendar,
      state,
      configuration,
      candidateId: "cal_event_acme_uk",
      desired: movedDesired,
      runId: "move-primitive-001",
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("Expected a successful Calendar move");
    expect(result.before.start.instant).toBe("2026-08-20T14:00:00.000Z");
    expect(result.desired.start.instant).toBe("2026-08-20T19:00:00.000Z");
    expect(result.after.start.instant).toBe("2026-08-20T19:00:00.000Z");
    expect(result.receipt).toMatchObject({ provider: "google_calendar", verified: true, resultingEtag: result.after.etag });
    expect(result.after.attendeeSetDigest).toBe(result.before.attendeeSetDigest);
    expect(result.after.privateTags).toEqual(result.before.privateTags);

    const operationReceipts = state.getCalendarOperationReceiptsForTest();
    expect(operationReceipts.map((receipt) => receipt.operation)).toEqual(["move", "move"]);
    expect(operationReceipts[0]).toMatchObject({ status: "started", before: result.before, desired: result.desired });
    expect(await state.readAll()).toEqual([
      expect.objectContaining({
        candidateId: "cal_event_acme_uk",
        expectedEtag: result.after.etag,
        expectedUpdatedAt: result.after.providerUpdated,
        lastReceipt: result,
      }),
      expect.anything(),
    ]);
  });

  it("restores only the recorded move after-state and returns to the immutable baseline", async () => {
    const { calendar, state } = await seededFixture();
    const moved = await moveControlledCalendarEvent({
      calendar,
      state,
      configuration,
      candidateId: "cal_event_acme_uk",
      desired: movedDesired,
      runId: "move-primitive-002",
    });
    expect(moved.status).toBe("succeeded");

    const restored = await restoreControlledCalendarEvent({
      calendar,
      state,
      configuration,
      candidateId: "cal_event_acme_uk",
      runId: "restore-primitive-001",
    });

    expect(restored.status).toBe("succeeded");
    if (restored.status !== "succeeded") throw new Error("Expected a successful Calendar restore");
    expect(restored.operation).toBe("restore");
    expect(restored.after.start.instant).toBe("2026-08-20T14:00:00.000Z");
    expect(restored.after.end.instant).toBe("2026-08-20T14:30:00.000Z");
    await expect(preflightControlledCalendar({ calendar, state, configuration })).resolves.toMatchObject({ status: "ok" });
  });

  it("fails closed on a stale provider version without issuing a write", async () => {
    const { calendar, state } = await seededFixture();
    const current = await calendar.getControlledEvent({ calendarId: configuration.calendarId, providerEventId: "fake-seeded-event-uk" });
    await calendar.updateStartEnd({
      calendarId: current.calendarId,
      providerEventId: current.providerEventId,
      expectedEtag: current.etag,
      start: { instant: "2026-08-20T18:00:00.000Z", timeZone: "America/New_York" },
      end: { instant: "2026-08-20T18:30:00.000Z", timeZone: "America/New_York" },
      sendUpdates: "none",
    });

    const result = await moveControlledCalendarEvent({
      calendar,
      state,
      configuration,
      candidateId: "cal_event_acme_uk",
      desired: movedDesired,
      runId: "move-primitive-003",
    });

    expect(result).toMatchObject({ status: "conflict", reason: "stale_state", after: null });
    expect(state.getCalendarOperationReceiptsForTest().at(-1)).toMatchObject({ status: "conflict", reason: "stale_state" });
    await expect(calendar.getControlledEvent({ calendarId: configuration.calendarId, providerEventId: "fake-seeded-event-uk" })).resolves.toMatchObject({
      start: { instant: "2026-08-20T18:00:00.000Z" },
    });
  });

  it("persists the precondition before a provider conflict and never rebases", async () => {
    const { calendar, state } = await seededFixture({
      events: [],
      organizerDigest: sha256Text(configuration.expectedEmail),
      failure: { operation: "update", kind: "conflict" },
    });

    const result = await moveControlledCalendarEvent({
      calendar,
      state,
      configuration,
      candidateId: "cal_event_acme_uk",
      desired: movedDesired,
      runId: "move-primitive-004",
    });

    expect(result).toMatchObject({ status: "conflict", reason: "provider_conflict", after: null });
    expect(state.getCalendarOperationReceiptsForTest().map((receipt) => receipt.status)).toEqual(["started", "conflict"]);
    expect(await calendar.getControlledEvent({ calendarId: configuration.calendarId, providerEventId: "fake-seeded-event-uk" })).toMatchObject({
      start: { instant: "2026-08-20T14:00:00.000Z" },
      end: { instant: "2026-08-20T14:30:00.000Z" },
    });
  });

  it("marks an unavailable update uncertain and does not auto-retry", async () => {
    const { calendar, state } = await seededFixture({
      events: [],
      organizerDigest: sha256Text(configuration.expectedEmail),
      failure: { operation: "update", kind: "unavailable" },
    });

    const result = await moveControlledCalendarEvent({
      calendar,
      state,
      configuration,
      candidateId: "cal_event_acme_uk",
      desired: movedDesired,
      runId: "move-primitive-005",
    });

    expect(result).toMatchObject({ status: "uncertain", reason: "provider_unavailable", after: null });
    expect(state.getCalendarOperationReceiptsForTest().map((receipt) => receipt.status)).toEqual(["started", "uncertain"]);
  });

  it("rejects restore before a successful move and invalid duration/time-zone changes", async () => {
    const { calendar, state } = await seededFixture();
    await expect(
      restoreControlledCalendarEvent({ calendar, state, configuration, candidateId: "cal_event_acme_uk", runId: "restore-primitive-002" }),
    ).rejects.toMatchObject({ kind: "restore_unavailable" });

    const invalidDesired = {
      ...movedDesired,
      end: { instant: "2026-08-20T20:00:00.000Z", timeZone: "UTC" },
    };
    await expect(
      moveControlledCalendarEvent({
        calendar,
        state,
        configuration,
        candidateId: "cal_event_acme_uk",
        desired: invalidDesired,
        runId: "move-primitive-006",
      }),
    ).rejects.toMatchObject({ kind: "invalid_desired_state" });
  });

  it("keeps the seed contract tied to the exact controlled time zone and duration", () => {
    expect(buildControlledCalendarSeeds(configuration)).toHaveLength(2);
    expect(() =>
      CalendarOperationDesiredSchema.parse({
        start: { instant: "2026-08-20T19:00:00.000Z", timeZone: "America/New_York" },
        end: { instant: "2026-08-20T20:00:00.000Z", timeZone: "America/New_York" },
        durationMinutes: 30,
        sendUpdates: "none",
      }),
    ).toThrow();
  });

  it("persists primitive receipts and rolling versions through the PostgreSQL state boundary", async () => {
    let queryValues: readonly unknown[] | undefined;
    const query = vi.fn(async (_text: string, values?: readonly unknown[]) => {
      queryValues = values;
      return { rowCount: 1, rows: [] };
    });
    const store = new PostgresDemoEventStateStore({ query } as unknown as Pool);
    const snapshot = {
      calendarId: configuration.calendarId,
      providerEventId: "provider-event-uk",
      title: "Acme UK renewal",
      company: "Acme" as const,
      region: "UK" as const,
      start: { instant: "2026-08-20T14:00:00.000Z", timeZone: "America/New_York" },
      end: { instant: "2026-08-20T14:30:00.000Z", timeZone: "America/New_York" },
      etag: "etag-before",
      providerUpdated: "2026-07-16T00:00:00.000Z",
      organizerDigest: sha256Text(configuration.expectedEmail),
      attendeeSetDigest: sha256Text("uk-team@example.com"),
      eventType: "default" as const,
      recurringEventId: null,
      ownedByConnectedAccount: true as const,
      privateTags: { rewind_demo: "acme-renewal" as const, region: "UK" as const },
    };
    const receipt = CalendarOperationDesiredSchema.parse({
      start: snapshot.start,
      end: snapshot.end,
      durationMinutes: 30,
      sendUpdates: "none",
    });
    await store.recordCalendarOperation({
      candidateId: "cal_event_acme_uk",
      receipt: {
        operation: "move",
        runId: "move-primitive-db",
        status: "started",
        before: snapshot,
        desired: receipt,
        lastVerifiedOperation: null,
        lastVerifiedAfter: null,
      },
      expectedEtag: "etag-after",
      expectedUpdatedAt: "2026-07-16T00:00:01.000Z",
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE demo_event_state"),
      expect.arrayContaining(["cal_event_acme_uk", "etag-after", "2026-07-16T00:00:01.000Z"]),
    );
    expect(JSON.parse(String(queryValues?.[3])).status).toBe("started");
  });
});
