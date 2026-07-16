import { describe, expect, it } from "vitest";
import { FakeCalendarPort } from "@/lib/adapters/calendar";
import {
  buildControlledCalendarSeeds,
  validateControlledCalendarEvents,
  validateSeededState,
  type CalendarDemoConfiguration,
} from "@/lib/domain/calendar-demo";
import { sha256Text } from "@/lib/domain/digest";
import { MemoryDemoEventStateStore } from "@/lib/db/demo-event-state";
import { preflightControlledCalendar, seedControlledCalendar } from "@/lib/services/calendar-demo";

const configuration: CalendarDemoConfiguration = {
  calendarId: "demo-calendar-2026",
  demoDate: "2026-08-20",
  expectedEmail: "owner@example.com",
  recipients: { UK: ["uk-team@example.com"], US: ["us-team@example.com"] },
};

describe("controlled Calendar discovery and seed domain", () => {
  it("builds exactly two 30-minute ET seeds on the configured demo date", () => {
    const seeds = buildControlledCalendarSeeds(configuration);
    expect(seeds).toHaveLength(2);
    expect(seeds.map((seed) => [seed.region, seed.start.instant, seed.end.instant])).toEqual([
      ["UK", "2026-08-20T14:00:00.000Z", "2026-08-20T14:30:00.000Z"],
      ["US", "2026-08-20T15:00:00.000Z", "2026-08-20T15:30:00.000Z"],
    ]);
    expect(seeds.every((seed) => seed.sendUpdates === "none" && seed.privateTags.rewind_demo === "acme-renewal")).toBe(true);
  });

  it("seeds, persists immutable baselines, and passes a matching preflight with a fake Calendar", async () => {
    const calendar = new FakeCalendarPort({
      events: [],
      organizerDigest: sha256Text(configuration.expectedEmail),
    });
    const state = new MemoryDemoEventStateStore();
    await expect(seedControlledCalendar({ calendar, state, configuration, runId: "seed-test-001" })).resolves.toMatchObject({
      status: "ok",
      eventsCreated: 2,
      baselineRecords: 2,
    });
    const saved = await state.readAll();
    expect(saved).toHaveLength(2);
    expect(saved.every((entry) => !Object.hasOwn(entry.semanticBaseline, "etag") && !Object.hasOwn(entry.semanticBaseline, "providerUpdated"))).toBe(true);
    expect(state.getAuditsForTest().map((audit) => audit.status)).toEqual(["started", "started"]);
    await expect(preflightControlledCalendar({ calendar, state, configuration })).resolves.toMatchObject({
      status: "ok",
      candidateCount: 2,
      baselineCount: 2,
      expectedVersionCount: 2,
    });
  });

  it("fails closed on existing tagged events, duplicate/incomplete candidates, and stale state", async () => {
    const source = new FakeCalendarPort({
      events: [],
      organizerDigest: sha256Text(configuration.expectedEmail),
    });
    const seed = buildControlledCalendarSeeds(configuration)[0];
    const existing = await source.createControlledEvent(seed);
    const existingCalendar = new FakeCalendarPort({
      events: [existing],
      organizerDigest: sha256Text(configuration.expectedEmail),
    });
    await expect(seedControlledCalendar({
      calendar: existingCalendar,
      state: new MemoryDemoEventStateStore(),
      configuration,
      runId: "seed-test-002",
    })).rejects.toMatchObject({ kind: "tagged_events_exist" });

    expect(() => validateControlledCalendarEvents([existing], configuration)).toThrow();
  });

  it("records a failed seed attempt and never retries a provider failure", async () => {
    const state = new MemoryDemoEventStateStore();
    const calendar = new FakeCalendarPort({
      events: [],
      organizerDigest: sha256Text(configuration.expectedEmail),
      failure: { operation: "create", kind: "unavailable" },
    });
    await expect(seedControlledCalendar({ calendar, state, configuration, runId: "seed-test-003" })).rejects.toMatchObject({
      kind: "provider_unavailable",
    });
    expect(await state.readAll()).toHaveLength(0);
    expect(state.getAuditsForTest()).toEqual([
      { operation: "seed", candidateId: "cal_event_acme_uk", runId: "seed-test-003", status: "started" },
      { operation: "seed", candidateId: "cal_event_acme_uk", runId: "seed-test-003", status: "failed", failureKind: "provider" },
    ]);
  });

  it("rejects a changed rolling provider version even when the semantic baseline remains equal", async () => {
    const calendar = new FakeCalendarPort({
      events: [],
      organizerDigest: sha256Text(configuration.expectedEmail),
    });
    const state = new MemoryDemoEventStateStore();
    await seedControlledCalendar({ calendar, state, configuration, runId: "seed-test-004" });
    const saved = await state.readAll();
    const current = await calendar.listControlledEvents({ calendarId: configuration.calendarId, tag: "acme-renewal" });
    const stale = saved.map((entry) => ({ ...entry, expectedEtag: `${entry.expectedEtag}-stale` }));
    expect(() => validateSeededState(current, stale, configuration)).toThrow();
  });
});
