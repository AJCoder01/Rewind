import { describe, expect, it } from "vitest";
import { FakeCalendarPort } from "@/lib/adapters/calendar";
import { buildControlledCalendarSeeds, type CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";
import { sha256Text } from "@/lib/domain/digest";
import {
  CandidateResolutionError,
  FixturePreLockRulePort,
  MemoryPlanningLockPort,
  NoActiveRulePort,
  assertCandidateResolutionFresh,
  refreshCandidateResolution,
  resolveBeforePlanning,
  resolveControlledCandidates,
} from "@/lib/services/candidate-resolution";

const configuration: CalendarDemoConfiguration = {
  calendarId: "demo-calendar-2026",
  demoDate: "2026-08-20",
  expectedEmail: "owner@example.com",
  recipients: { UK: ["uk-team@example.com"], US: ["us-team@example.com"] },
};

async function seededCalendar() {
  const source = new FakeCalendarPort({ events: [], organizerDigest: sha256Text(configuration.expectedEmail) });
  for (const seed of buildControlledCalendarSeeds(configuration)) await source.createControlledEvent(seed);
  const events = await source.listControlledEvents({ calendarId: configuration.calendarId, tag: "acme-renewal" });
  return { source, events };
}

describe("S047 live candidate resolution", () => {
  it("retrieves exactly two tagged events, ranks UK, and retains US as the alternative", async () => {
    const { source } = await seededCalendar();
    const resolution = await resolveControlledCandidates({ calendar: source, configuration, now: new Date("2026-07-16T00:00:00.000Z") });
    expect(resolution.candidates).toHaveLength(2);
    expect(resolution.selectedCandidateId).toBe("cal_event_acme_uk");
    expect(resolution.alternativeCandidateIds).toEqual(["cal_event_acme_us"]);
    expect(resolution.rankedCandidateIds).toEqual(["cal_event_acme_uk", "cal_event_acme_us"]);
    expect(resolution.candidates[0].providerEventId).toBe("fake-seeded-event-uk");
    expect(resolution.snapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("evaluates the rule before acquiring the planning lock", async () => {
    const { source } = await seededCalendar();
    const lock = new MemoryPlanningLockPort();
    const clarified = await resolveBeforePlanning({
      request: "controlled request",
      worldPrId: "wpr_rule_test_0001",
      calendar: source,
      configuration,
      rule: new FixturePreLockRulePort(true),
      lock,
    });
    expect(clarified.rule.matched).toBe(true);
    expect(clarified.lock).toBeNull();
    expect(lock.hasLock()).toBe(false);

    const planned = await resolveBeforePlanning({
      request: "controlled request",
      worldPrId: "wpr_rule_test_0002",
      calendar: source,
      configuration,
      rule: new NoActiveRulePort(),
      lock,
    });
    expect(planned.rule.matched).toBe(false);
    expect(planned.lock?.worldPrId).toBe("wpr_rule_test_0002");
    expect(lock.hasLock()).toBe(true);
  });

  it("fails closed on missing, duplicate, malformed, or wrong-date candidates", async () => {
    const { events } = await seededCalendar();
    const missing = new FakeCalendarPort({ events: [events[0]], organizerDigest: sha256Text(configuration.expectedEmail) });
    await expect(resolveControlledCandidates({ calendar: missing, configuration })).rejects.toMatchObject({ kind: "candidate_count" });

    const duplicateRegion = new FakeCalendarPort({
      events: [events[0], { ...events[0], providerEventId: "fake-other-uk" }],
      organizerDigest: sha256Text(configuration.expectedEmail),
    });
    await expect(resolveControlledCandidates({ calendar: duplicateRegion, configuration })).rejects.toMatchObject({ kind: "candidate_count" });

    const wrongDate = new FakeCalendarPort({
      events: [events[0], {
        ...events[1],
        start: { ...events[1].start, instant: "2026-08-21T15:00:00.000Z" },
        end: { ...events[1].end, instant: "2026-08-21T15:30:00.000Z" },
      }],
      organizerDigest: sha256Text(configuration.expectedEmail),
    });
    await expect(resolveControlledCandidates({ calendar: wrongDate, configuration })).rejects.toMatchObject({ kind: "candidate_invalid" });
  });

  it("detects provider-version drift and creates an explicit refresh version", async () => {
    const { source } = await seededCalendar();
    const original = await resolveControlledCandidates({ calendar: source, configuration });
    const refreshed = await refreshCandidateResolution({ previous: original, calendar: source, configuration });
    expect(refreshed.resolutionVersion).toBe(2);
    expect(refreshed.snapshotDigest).toBe(original.snapshotDigest);
    expect(() => assertCandidateResolutionFresh(original, refreshed)).not.toThrow();

    const changedSource = new FakeCalendarPort({
      events: (await source.listControlledEvents({ calendarId: configuration.calendarId, tag: "acme-renewal" })).map((event) =>
        event.region === "UK" ? { ...event, etag: `${event.etag}-changed` } : event,
      ),
      organizerDigest: sha256Text(configuration.expectedEmail),
    });
    const changed = await resolveControlledCandidates({ calendar: changedSource, configuration, resolutionVersion: 2, supersedesPlanId: "plan_previous_0001" });
    expect(changed.supersedesPlanId).toBe("plan_previous_0001");
    expect(() => assertCandidateResolutionFresh(original, changed)).toThrowError(CandidateResolutionError);
    expect((() => { try { assertCandidateResolutionFresh(original, changed); return "ok"; } catch (error) { return error; } })()).toMatchObject({ kind: "stale_snapshot" });
  });
});
