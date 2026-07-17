import { z } from "zod";
import { CalendarProviderError, type CalendarPort } from "@/lib/adapters/calendar";
import {
  CalendarOperationDesiredSchema,
  CalendarOperationReceiptSchema,
  type CalendarOperationDesired,
  type CalendarOperationReceipt,
  type DemoEventState,
} from "@/lib/contracts/calendar-demo";
import type { CalendarEventSnapshot } from "@/lib/contracts/provider-ports";
import {
  buildControlledCalendarSeeds,
  candidateRegion,
  validateControlledCalendarEventMetadata,
  type CalendarDemoConfiguration,
} from "@/lib/domain/calendar-demo";
import { canonicalJson } from "@/lib/domain/digest";
import type { DemoEventStateStore } from "@/lib/db/demo-event-state";

export type CalendarPrimitiveErrorKind =
  | "invalid_configuration"
  | "invalid_desired_state"
  | "state_missing"
  | "restore_unavailable"
  | "candidate_mismatch"
  | "persistence_failed"
  | "provider_unavailable";

export class CalendarPrimitiveError extends Error {
  readonly kind: CalendarPrimitiveErrorKind;

  constructor(kind: CalendarPrimitiveErrorKind) {
    super("Calendar primitive failed safely.");
    this.name = "CalendarPrimitiveError";
    this.kind = kind;
  }
}

type CalendarOperation = "move" | "restore";

type OperationInput = Readonly<{
  operation: CalendarOperation;
  calendar: CalendarPort;
  state: DemoEventStateStore;
  configuration: CalendarDemoConfiguration;
  candidateId: DemoEventState["candidateId"];
  desired?: CalendarOperationDesired;
  runId: string;
}>;

function lastVerifiedState(
  receipt: DemoEventState["lastReceipt"],
): { operation: "move" | "restore"; after: CalendarEventSnapshot } | undefined {
  if (receipt.operation === "seed" || !receipt.lastVerifiedAfter || !receipt.lastVerifiedOperation) return undefined;
  return { operation: receipt.lastVerifiedOperation, after: receipt.lastVerifiedAfter };
}

function expectedCurrentSnapshot(state: DemoEventState): Pick<CalendarEventSnapshot, "start" | "end"> {
  return lastVerifiedState(state.lastReceipt)?.after ?? state.semanticBaseline;
}

function sameTimes(left: Pick<CalendarEventSnapshot, "start" | "end">, right: Pick<CalendarEventSnapshot, "start" | "end">): boolean {
  return canonicalJson(left.start) === canonicalJson(right.start) && canonicalJson(left.end) === canonicalJson(right.end);
}

function sameImmutableFields(before: CalendarEventSnapshot, after: CalendarEventSnapshot): boolean {
  const withoutMutableFields = (snapshot: CalendarEventSnapshot) => ({
    calendarId: snapshot.calendarId,
    providerEventId: snapshot.providerEventId,
    title: snapshot.title,
    company: snapshot.company,
    region: snapshot.region,
    organizerDigest: snapshot.organizerDigest,
    attendeeSetDigest: snapshot.attendeeSetDigest,
    eventType: snapshot.eventType,
    recurringEventId: snapshot.recurringEventId,
    ownedByConnectedAccount: snapshot.ownedByConnectedAccount,
    privateTags: snapshot.privateTags,
  });
  return canonicalJson(withoutMutableFields(before)) === canonicalJson(withoutMutableFields(after));
}

function desiredFromBaseline(state: DemoEventState): CalendarOperationDesired {
  return CalendarOperationDesiredSchema.parse({
    start: state.semanticBaseline.start,
    end: state.semanticBaseline.end,
    durationMinutes: state.semanticBaseline.durationMinutes,
    sendUpdates: "none",
  });
}

function parseDesired(
  desired: CalendarOperationDesired | undefined,
  state: DemoEventState,
  configuration: CalendarDemoConfiguration,
): CalendarOperationDesired {
  let parsed: CalendarOperationDesired;
  try {
    parsed = CalendarOperationDesiredSchema.parse(desired);
  } catch {
    throw new CalendarPrimitiveError("invalid_desired_state");
  }
  if (
    parsed.start.timeZone !== state.semanticBaseline.start.timeZone ||
    parsed.end.timeZone !== state.semanticBaseline.end.timeZone
  ) {
    throw new CalendarPrimitiveError("candidate_mismatch");
  }
  try {
    // This validates the fixed controlled date, account, and recipient shape
    // before any provider read or write is attempted.
    buildControlledCalendarSeeds(configuration);
  } catch {
    throw new CalendarPrimitiveError("invalid_configuration");
  }
  return parsed;
}

function parseRunId(runId: string): string {
  try {
    return z.string().min(8).max(200).parse(runId);
  } catch {
    throw new CalendarPrimitiveError("invalid_desired_state");
  }
}

async function record(
  state: DemoEventStateStore,
  input: Parameters<DemoEventStateStore["recordCalendarOperation"]>[0],
): Promise<void> {
  try {
    await state.recordCalendarOperation(input);
  } catch {
    throw new CalendarPrimitiveError("persistence_failed");
  }
}

async function recordOwnedStart(
  state: DemoEventStateStore,
  candidateId: DemoEventState["candidateId"],
  currentState: DemoEventState,
  started: CalendarOperationReceipt,
): Promise<void> {
  await record(state, { candidateId, receipt: started });
  try {
    const prepared = (await state.readAll()).find((candidate) => candidate.candidateId === candidateId);
    if (
      !prepared ||
      prepared.expectedEtag !== currentState.expectedEtag ||
      prepared.expectedUpdatedAt !== currentState.expectedUpdatedAt ||
      canonicalJson(prepared.lastReceipt) !== canonicalJson(started)
    ) {
      throw new CalendarPrimitiveError("persistence_failed");
    }
  } catch (error) {
    if (error instanceof CalendarPrimitiveError) throw error;
    throw new CalendarPrimitiveError("persistence_failed");
  }
}

function conflictReceipt(
  operation: CalendarOperation,
  runId: string,
  before: CalendarEventSnapshot,
  desired: CalendarOperationDesired,
  reason: Extract<CalendarOperationReceipt, { status: "conflict" }>["reason"],
  lastVerified: { operation: "move" | "restore"; after: CalendarEventSnapshot } | undefined,
): CalendarOperationReceipt {
  return CalendarOperationReceiptSchema.parse({
    operation,
    runId,
    status: "conflict",
    before,
    desired,
    after: null,
    reason,
    lastVerifiedOperation: lastVerified?.operation ?? null,
    lastVerifiedAfter: lastVerified?.after ?? null,
  });
}

function uncertainReceipt(
  operation: CalendarOperation,
  runId: string,
  before: CalendarEventSnapshot,
  desired: CalendarOperationDesired,
  after: CalendarEventSnapshot | null,
  reason: Extract<CalendarOperationReceipt, { status: "uncertain" }>["reason"],
  lastVerified: { operation: "move" | "restore"; after: CalendarEventSnapshot } | undefined,
): CalendarOperationReceipt {
  return CalendarOperationReceiptSchema.parse({
    operation,
    runId,
    status: "uncertain",
    before,
    desired,
    after,
    reason,
    lastVerifiedOperation: lastVerified?.operation ?? null,
    lastVerifiedAfter: lastVerified?.after ?? null,
  });
}

async function executeCalendarOperation(input: OperationInput): Promise<CalendarOperationReceipt> {
  const runId = parseRunId(input.runId);
  const states = await input.state.readAll();
  const currentState = states.find((state) => state.candidateId === input.candidateId);
  if (!currentState) throw new CalendarPrimitiveError("state_missing");

  const desired = parseDesired(input.desired, currentState, input.configuration);
  const region = candidateRegion(input.candidateId);
  const lastVerified = lastVerifiedState(currentState.lastReceipt);
  if (input.operation === "restore" && (!lastVerified || lastVerified.operation !== "move")) {
    throw new CalendarPrimitiveError("restore_unavailable");
  }

  let before: CalendarEventSnapshot;
  try {
    before = await input.calendar.getControlledEvent({
      calendarId: currentState.semanticBaseline.calendarId,
      providerEventId: currentState.semanticBaseline.providerEventId,
    });
    validateControlledCalendarEventMetadata(before, input.configuration, region);
  } catch (error) {
    if (error instanceof CalendarPrimitiveError) throw error;
    if (error instanceof CalendarProviderError) throw new CalendarPrimitiveError("provider_unavailable");
    throw new CalendarPrimitiveError("candidate_mismatch");
  }

  const expectedTimes = expectedCurrentSnapshot(currentState);
  if (
    before.etag !== currentState.expectedEtag ||
    before.providerUpdated !== currentState.expectedUpdatedAt ||
    !sameTimes(before, expectedTimes)
  ) {
    const conflict = conflictReceipt(input.operation, runId, before, desired, "stale_state", lastVerified);
    await record(input.state, { candidateId: input.candidateId, receipt: conflict });
    return conflict;
  }

  if (input.operation === "restore" && (!lastVerified || !sameTimes(before, lastVerified.after))) {
    const conflict = conflictReceipt(input.operation, runId, before, desired, "stale_state", lastVerified);
    await record(input.state, { candidateId: input.candidateId, receipt: conflict });
    return conflict;
  }

  const started = CalendarOperationReceiptSchema.parse({
    operation: input.operation,
    runId,
    status: "started",
    before,
    desired,
    lastVerifiedOperation: lastVerified?.operation ?? null,
    lastVerifiedAfter: lastVerified?.after ?? null,
  });
  await recordOwnedStart(input.state, input.candidateId, currentState, started);

  let after: CalendarEventSnapshot;
  try {
    after = await input.calendar.updateStartEnd({
      calendarId: before.calendarId,
      providerEventId: before.providerEventId,
      expectedEtag: before.etag,
      start: desired.start,
      end: desired.end,
      sendUpdates: "none",
    });
  } catch (error) {
    const receipt =
      error instanceof CalendarProviderError && error.kind === "conflict"
        ? conflictReceipt(input.operation, runId, before, desired, "provider_conflict", lastVerified)
        : error instanceof CalendarProviderError && error.kind === "not_found"
          ? conflictReceipt(input.operation, runId, before, desired, "provider_not_found", lastVerified)
          : uncertainReceipt(input.operation, runId, before, desired, null, "provider_unavailable", lastVerified);
    await record(input.state, { candidateId: input.candidateId, receipt });
    return receipt;
  }

  let verified = true;
  try {
    validateControlledCalendarEventMetadata(after, input.configuration, region);
    verified =
      after.calendarId === before.calendarId &&
      after.providerEventId === before.providerEventId &&
      after.etag !== before.etag &&
      sameImmutableFields(before, after) &&
      sameTimes(after, desired);
  } catch {
    verified = false;
  }

  if (!verified) {
    const receipt = uncertainReceipt(input.operation, runId, before, desired, after, "verification_failed", lastVerified);
    await record(input.state, { candidateId: input.candidateId, receipt });
    return receipt;
  }

  const receipt = CalendarOperationReceiptSchema.parse({
    operation: input.operation,
    runId,
    status: "succeeded",
    before,
    desired,
    after,
    receipt: {
      provider: "google_calendar",
      operation: input.operation,
      providerEventId: after.providerEventId,
      resultingEtag: after.etag,
      verified: true,
    },
    lastVerifiedOperation: input.operation,
    lastVerifiedAfter: after,
  });
  await record(input.state, {
    candidateId: input.candidateId,
    receipt,
    expectedEtag: after.etag,
    expectedUpdatedAt: after.providerUpdated,
  });
  return receipt;
}

export async function moveControlledCalendarEvent(input: Omit<OperationInput, "operation" | "desired"> & { desired: CalendarOperationDesired }): Promise<CalendarOperationReceipt> {
  return executeCalendarOperation({ ...input, operation: "move" });
}

export async function restoreControlledCalendarEvent(input: Omit<OperationInput, "operation" | "desired">): Promise<CalendarOperationReceipt> {
  const states = await input.state.readAll();
  const state = states.find((candidate) => candidate.candidateId === input.candidateId);
  if (!state) throw new CalendarPrimitiveError("state_missing");
  return executeCalendarOperation({ ...input, operation: "restore", desired: desiredFromBaseline(state) });
}
