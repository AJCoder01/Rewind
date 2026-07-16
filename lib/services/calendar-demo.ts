import { CALENDAR_DEMO_CONTRACT_VERSION, type DemoEventState } from "@/lib/contracts/calendar-demo";
import { CalendarProviderError, type CalendarPort } from "@/lib/adapters/calendar";
import {
  buildControlledCalendarSeeds,
  buildSeededDemoEventState,
  validateControlledCalendarEvent,
  validateControlledCalendarEvents,
  validateSeededState,
  type CalendarDemoConfiguration,
} from "@/lib/domain/calendar-demo";
import { DemoEventStateSchema, type ControlledCalendarCandidateId } from "@/lib/contracts/calendar-demo";
import type { DemoEventStateStore } from "@/lib/db/demo-event-state";

export type CalendarDemoSetupErrorKind =
  | "state_exists"
  | "tagged_events_exist"
  | "provider_unavailable"
  | "seed_partial"
  | "post_seed_validation_failed"
  | "preflight_failed"
  | "state_persistence_failed";

export class CalendarDemoSetupError extends Error {
  readonly kind: CalendarDemoSetupErrorKind;

  constructor(kind: CalendarDemoSetupErrorKind) {
    super("Controlled Calendar setup or preflight failed safely.");
    this.name = "CalendarDemoSetupError";
    this.kind = kind;
  }
}

export type CalendarDemoPreflightResult = Readonly<{
  status: "ok";
  contractVersion: typeof CALENDAR_DEMO_CONTRACT_VERSION;
  candidateCount: 2;
  baselineCount: 2;
  expectedVersionCount: 2;
}>;

function candidateIdForRegion(region: "UK" | "US"): ControlledCalendarCandidateId {
  return region === "UK" ? "cal_event_acme_uk" : "cal_event_acme_us";
}

function failureKind(error: unknown): "provider" | "validation" | "persistence" {
  if (error instanceof CalendarProviderError || error instanceof CalendarDemoSetupError) return "provider";
  if (error instanceof Error && error.name === "CalendarDemoValidationError") return "validation";
  return "persistence";
}

async function recordSeedFailure(
  state: DemoEventStateStore,
  candidateId: ControlledCalendarCandidateId,
  runId: string,
  error: unknown,
): Promise<void> {
  await state.recordSeedAudit({ candidateId, runId, status: "failed", failureKind: failureKind(error) }).catch(() => undefined);
}

function providerFailure(error: unknown): CalendarDemoSetupError {
  return error instanceof CalendarProviderError
    ? new CalendarDemoSetupError("provider_unavailable")
    : new CalendarDemoSetupError("seed_partial");
}

/**
 * Seed exactly the two controlled events. The caller must have already passed
 * the TTY/environment gate; this service itself never prompts or reads secrets.
 */
export async function seedControlledCalendar(input: Readonly<{
  calendar: CalendarPort;
  state: DemoEventStateStore;
  configuration: CalendarDemoConfiguration;
  runId: string;
}>): Promise<Readonly<{ status: "ok"; contractVersion: typeof CALENDAR_DEMO_CONTRACT_VERSION; eventsCreated: 2; baselineRecords: 2 }>> {
  const existingStates = await input.state.readAll();
  if (existingStates.length > 0) throw new CalendarDemoSetupError("state_exists");

  let existingEvents: readonly Awaited<ReturnType<CalendarPort["listControlledEvents"]>>[number][];
  try {
    existingEvents = await input.calendar.listControlledEvents({ calendarId: input.configuration.calendarId, tag: "acme-renewal" });
  } catch (error) {
    throw providerFailure(error);
  }
  if (existingEvents.length > 0) throw new CalendarDemoSetupError("tagged_events_exist");

  const seeds = buildControlledCalendarSeeds(input.configuration);
  let created = 0;
  for (const seed of seeds) {
    const candidateId = candidateIdForRegion(seed.region);
    try {
      await input.state.recordSeedAudit({ candidateId, runId: input.runId, status: "started" });
    } catch {
      throw new CalendarDemoSetupError("state_persistence_failed");
    }

    let snapshot: Awaited<ReturnType<CalendarPort["createControlledEvent"]>>;
    try {
      snapshot = await input.calendar.createControlledEvent(seed);
    } catch (error) {
      await recordSeedFailure(input.state, candidateId, input.runId, error);
      throw error instanceof CalendarProviderError ? new CalendarDemoSetupError("provider_unavailable") : new CalendarDemoSetupError("seed_partial");
    }

    try {
      const candidate = validateControlledCalendarEvent(snapshot, input.configuration, seed.region);
      const state = DemoEventStateSchema.parse(buildSeededDemoEventState(candidate, input.runId));
      await input.state.saveSeededState(state);
      created += 1;
    } catch (error) {
      await recordSeedFailure(input.state, candidateId, input.runId, error);
      if (error instanceof CalendarDemoSetupError) throw error;
      if (error instanceof Error && error.name === "CalendarDemoValidationError") throw new CalendarDemoSetupError("seed_partial");
      throw new CalendarDemoSetupError("state_persistence_failed");
    }
  }

  try {
    const finalEvents = await input.calendar.listControlledEvents({ calendarId: input.configuration.calendarId, tag: "acme-renewal" });
    const finalStates = await input.state.readAll();
    validateSeededState(finalEvents, finalStates, input.configuration);
  } catch {
    throw new CalendarDemoSetupError("post_seed_validation_failed");
  }

  if (created !== 2) throw new CalendarDemoSetupError("post_seed_validation_failed");
  return { status: "ok", contractVersion: CALENDAR_DEMO_CONTRACT_VERSION, eventsCreated: 2, baselineRecords: 2 };
}

export async function preflightControlledCalendar(input: Readonly<{
  calendar: CalendarPort;
  state: DemoEventStateStore;
  configuration: CalendarDemoConfiguration;
}>): Promise<CalendarDemoPreflightResult> {
  try {
    const storedStates: readonly DemoEventState[] = await input.state.readAll();
    const events = await input.calendar.listControlledEvents({ calendarId: input.configuration.calendarId, tag: "acme-renewal" });
    validateSeededState(events, storedStates, input.configuration);
    validateControlledCalendarEvents(events, input.configuration);
    return {
      status: "ok",
      contractVersion: CALENDAR_DEMO_CONTRACT_VERSION,
      candidateCount: 2,
      baselineCount: 2,
      expectedVersionCount: 2,
    };
  } catch (error) {
    if (error instanceof CalendarDemoSetupError) throw error;
    if (error instanceof CalendarProviderError) throw new CalendarDemoSetupError("provider_unavailable");
    throw new CalendarDemoSetupError("preflight_failed");
  }
}
