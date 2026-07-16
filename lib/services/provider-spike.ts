import type { CalendarPort } from "@/lib/adapters/calendar";
import {
  CalendarOperationDesiredSchema,
  type CalendarOperationReceipt,
  type ControlledCalendarCandidateId,
} from "@/lib/contracts/calendar-demo";
import type { DemoEventStateStore } from "@/lib/db/demo-event-state";
import { buildControlledCalendarSeeds, CalendarDemoValidationError, type CalendarDemoConfiguration } from "@/lib/domain/calendar-demo";
import { moveControlledCalendarEvent, restoreControlledCalendarEvent } from "@/lib/services/calendar-primitives";
import { preflightControlledCalendar } from "@/lib/services/calendar-demo";
import { CalendarPrimitiveError } from "@/lib/services/calendar-primitives";
import { CalendarDemoSetupError } from "@/lib/services/calendar-demo";
import { DemoCommandGuardError } from "@/lib/services/calendar-demo-command";
import { EnvironmentConfigError } from "@/lib/config/environment";
import { CalendarProviderError } from "@/lib/adapters/calendar";
import { sha256Text } from "@/lib/domain/digest";
import { OpenAIResponsesError } from "@/lib/ai/openai-responses";
import { ModelSafetyError } from "@/lib/ai/model-safety";
import { GoogleOAuthProviderError } from "@/lib/google/oauth";

export type ProviderSpikeGuardKind =
  | "live_flag_required"
  | "execution_enabled"
  | "reset_enabled";

export type ProviderSpikeFailureKind =
  | "credential_unavailable"
  | "calendar_configuration_invalid"
  | "calendar_unexpected_receipt"
  | "model_metadata_incomplete";

export class ProviderSpikeGuardError extends Error {
  readonly kind: ProviderSpikeGuardKind;

  constructor(kind: ProviderSpikeGuardKind) {
    super("The controlled provider/model spike is not permitted in this environment.");
    this.name = "ProviderSpikeGuardError";
    this.kind = kind;
  }
}

export class ProviderSpikeFailureError extends Error {
  readonly kind: ProviderSpikeFailureKind;

  constructor(kind: ProviderSpikeFailureKind) {
    super("The controlled provider/model spike failed safely.");
    this.name = "ProviderSpikeFailureError";
    this.kind = kind;
  }
}

export function assertProviderSpikeExecutionDisabled(environment: Readonly<Record<string, string | undefined>>): void {
  if (environment.LIVE_INTEGRATION_TESTS !== "1") throw new ProviderSpikeGuardError("live_flag_required");
  if (/^(1|true|yes)$/i.test((environment.REWIND_PRODUCT_EXECUTION_ENABLED ?? "").trim())) {
    throw new ProviderSpikeGuardError("execution_enabled");
  }
  if (/^(1|true|yes)$/i.test((environment.REWIND_PRODUCT_RESET_ENABLED ?? "").trim())) {
    throw new ProviderSpikeGuardError("reset_enabled");
  }
}

export function providerSpikeTargetFingerprint(calendarId: string, databaseUrl: string): string {
  return sha256Text(`provider-spike\0${calendarId}\0database\0${databaseUrl}`).slice(0, 23);
}

export function providerSpikeConfirmationPhrase(runId: string, calendarId: string): string {
  if (!runId || !calendarId || /[\r\n]/.test(runId) || /[\r\n]/.test(calendarId)) {
    throw new ProviderSpikeGuardError("live_flag_required");
  }
  return `CONFIRM PROVIDER SPIKE ${runId} CALENDAR ${calendarId}`;
}

export function safeProviderSpikeFailureCode(error: unknown): string {
  if (error instanceof ProviderSpikeGuardError) return error.kind;
  if (error instanceof ProviderSpikeFailureError) return error.kind;
  if (error instanceof DemoCommandGuardError) return error.kind;
  if (error instanceof CalendarDemoSetupError) return error.kind;
  if (error instanceof CalendarDemoValidationError) return error.kind;
  if (error instanceof CalendarPrimitiveError) return error.kind;
  if (error instanceof CalendarProviderError) return "provider_unavailable";
  if (error instanceof GoogleOAuthProviderError) return `oauth_${error.reason}`;
  if (error instanceof OpenAIResponsesError) return `openai_${error.kind}`;
  if (error instanceof ModelSafetyError) return `model_${error.operation}_${error.kind}`;
  if (error instanceof EnvironmentConfigError) return "invalid_environment";
  return "failed_safely";
}

/**
 * Execute the non-effecting model proof before any Calendar mutation. This
 * prevents model configuration/provider failures from causing repeated live
 * Calendar move/restore cycles during the human spike.
 */
export async function runControlledProviderModelSpikePhases<TModel, TCalendar>(input: Readonly<{
  runModel: () => Promise<TModel>;
  runCalendar: () => Promise<TCalendar>;
}>): Promise<Readonly<{ model: TModel; calendar: TCalendar }>> {
  const model = await input.runModel();
  const calendar = await input.runCalendar();
  return { model, calendar };
}

/**
 * Provider-spike-only Calendar wrapper. It forces one stale If-Match request
 * to the real adapter, which must return a 412 without changing the event.
 * It is not used by product routes and never retries the request.
 */
export class StaleIfMatchCalendarPort implements CalendarPort {
  constructor(private readonly delegate: CalendarPort) {}

  listControlledEvents(input: Parameters<CalendarPort["listControlledEvents"]>[0]): ReturnType<CalendarPort["listControlledEvents"]> {
    return this.delegate.listControlledEvents(input);
  }

  getControlledEvent(input: Parameters<CalendarPort["getControlledEvent"]>[0]): ReturnType<CalendarPort["getControlledEvent"]> {
    return this.delegate.getControlledEvent(input);
  }

  createControlledEvent(input: Parameters<CalendarPort["createControlledEvent"]>[0]): ReturnType<CalendarPort["createControlledEvent"]> {
    return this.delegate.createControlledEvent(input);
  }

  updateStartEnd(input: Parameters<CalendarPort["updateStartEnd"]>[0]): ReturnType<CalendarPort["updateStartEnd"]> {
    return this.delegate.updateStartEnd({ ...input, expectedEtag: `${input.expectedEtag}-stale-spike` });
  }
}

function shiftedDesired(configuration: CalendarDemoConfiguration, candidateId: ControlledCalendarCandidateId) {
  const region = candidateId.endsWith("_uk") ? "UK" : "US";
  const seed = buildControlledCalendarSeeds(configuration).find((candidate) => candidate.region === region);
  if (!seed) throw new ProviderSpikeFailureError("calendar_configuration_invalid");
  const start = new Date(Date.parse(seed.start.instant) - 60 * 60_000).toISOString();
  const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
  return CalendarOperationDesiredSchema.parse({
    start: { instant: start, timeZone: seed.start.timeZone },
    end: { instant: end, timeZone: seed.end.timeZone },
    durationMinutes: 30,
    sendUpdates: "none",
  });
}

function receiptSummary(receipt: CalendarOperationReceipt): { status: "succeeded" | "conflict"; reason?: "provider_conflict" } {
  if (receipt.status === "succeeded") return { status: "succeeded" };
  if (receipt.status === "conflict" && receipt.reason === "provider_conflict") {
    return { status: "conflict", reason: "provider_conflict" };
  }
  throw new ProviderSpikeFailureError("calendar_unexpected_receipt");
}

/**
 * Run the low-level two-event Calendar proof. The caller owns the TTY and
 * human confirmation; this service never prompts and never invokes product
 * execution or reset paths.
 */
export async function runControlledCalendarProviderSpike(input: Readonly<{
  calendar: CalendarPort;
  state: DemoEventStateStore;
  configuration: CalendarDemoConfiguration;
  runId: string;
}>): Promise<Readonly<{
  preflightBefore: Awaited<ReturnType<typeof preflightControlledCalendar>>;
  staleConflict: ReturnType<typeof receiptSummary>;
  move: ReturnType<typeof receiptSummary>;
  restore: ReturnType<typeof receiptSummary>;
  preflightAfter: Awaited<ReturnType<typeof preflightControlledCalendar>>;
  partialReceiptStatuses: { uk: ["succeeded", "succeeded"]; us: ["conflict"] };
}>> {
  const preflightBefore = await preflightControlledCalendar(input);
  const staleConflictReceipt = await moveControlledCalendarEvent({
    calendar: new StaleIfMatchCalendarPort(input.calendar),
    state: input.state,
    configuration: input.configuration,
    candidateId: "cal_event_acme_us",
    desired: shiftedDesired(input.configuration, "cal_event_acme_us"),
    runId: `${input.runId}-conflict`,
  });
  const staleConflict = receiptSummary(staleConflictReceipt);
  if (staleConflict.status !== "conflict") throw new Error("Calendar provider spike conflict was not recorded.");

  const movedReceipt = await moveControlledCalendarEvent({
    calendar: input.calendar,
    state: input.state,
    configuration: input.configuration,
    candidateId: "cal_event_acme_uk",
    desired: shiftedDesired(input.configuration, "cal_event_acme_uk"),
    runId: `${input.runId}-move`,
  });
  const move = receiptSummary(movedReceipt);
  if (move.status !== "succeeded") throw new Error("Calendar provider spike move was not verified.");
  const restoredReceipt = await restoreControlledCalendarEvent({
    calendar: input.calendar,
    state: input.state,
    configuration: input.configuration,
    candidateId: "cal_event_acme_uk",
    runId: `${input.runId}-restore`,
  });
  const restore = receiptSummary(restoredReceipt);
  if (restore.status !== "succeeded") throw new Error("Calendar provider spike restore was not verified.");
  const preflightAfter = await preflightControlledCalendar(input);

  return {
    preflightBefore,
    staleConflict,
    move,
    restore,
    preflightAfter,
    partialReceiptStatuses: { uk: [move.status, restore.status], us: [staleConflict.status] },
  };
}
