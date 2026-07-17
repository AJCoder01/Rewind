import { z } from "zod";
import {
  InitialCalendarAfterStateSchema,
  InitialCalendarBeforeStateSchema,
  InitialCalendarExecutionResultSchema,
  InitialCalendarMoveReceiptSchema,
  type InitialCalendarBeforeState,
  type InitialCalendarExecutionResult,
  type InitialCalendarMoveReceipt,
} from "@/lib/contracts/initial-calendar-execution";
import { type ActionExecutionRecord, type ExecutionPlan } from "@/lib/contracts/execution-persistence";
import {
  CalendarConditionalTimeUpdateSchema,
  CalendarEventSnapshotSchema,
  type CalendarEventSnapshot,
} from "@/lib/contracts/provider-ports";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { OpaqueIdSchema, type InitialPlanPayload } from "@/lib/contracts/v1";
import { CalendarProviderError, type CalendarPort } from "@/lib/adapters/calendar";
import { ExecutionPersistenceError, type ExecutionPersistenceStore } from "@/lib/db/execution-store";
import {
  CalendarDemoValidationError,
  type CalendarDemoConfiguration,
  validateControlledCalendarEventMetadata,
} from "@/lib/domain/calendar-demo";
import { canonicalJson } from "@/lib/domain/digest";
import { claimApprovedInitialAction } from "@/lib/services/initial-execution";
import { ServiceError } from "@/lib/services/world-pr";

const InitialCalendarExecutionRequestSchema = z
  .object({
    actorId: z.string().min(1).max(200),
    source: z.enum(["dashboard", "mcp"]),
    planId: OpaqueIdSchema,
    planDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    now: z.string().datetime({ offset: true }),
    leaseUntil: z.string().datetime({ offset: true }),
  })
  .strict();

export type InitialCalendarExecutionInput = z.infer<typeof InitialCalendarExecutionRequestSchema>;

export type InitialCalendarExecutionDependencies = Readonly<{
  executionStore: ExecutionPersistenceStore;
  calendar: CalendarPort;
  configuration: CalendarDemoConfiguration;
}>;

type CalendarMoveAction = InitialPlanPayload["actions"][1];
type TerminalCalendarStatus = "retryable_failed" | "conflict" | "permanently_failed";
type CalendarTerminalReason =
  | "provider_unavailable"
  | "provider_not_found"
  | "provider_conflict"
  | "precondition_changed"
  | "verification_failed"
  | "calendar_uncertain"
  | "invalid_snapshot"
  | "invalid_configuration"
  | "conflict"
  | "permanently_failed";

export async function executeApprovedInitialCalendar(
  input: InitialCalendarExecutionInput,
  dependencies: InitialCalendarExecutionDependencies,
): Promise<InitialCalendarExecutionResult> {
  const request = InitialCalendarExecutionRequestSchema.safeParse(input);
  if (!request.success) throw new ServiceError("invalid_request", "The initial Calendar execution request did not match the strict contract.");

  const plan = await loadVerifiedPlan(request.data.planId, request.data.planDigest, dependencies.executionStore);
  const action = calendarActionFromPlan(plan);
  const claim = await claimApprovedInitialAction(
    {
      ...request.data,
      actionKey: "initial.calendar.move",
    },
    dependencies.executionStore,
  );

  if (claim.decision === "skipped") return calendarResult("skipped", claim.record, calendarReceiptFromRecord(claim.record));
  if (claim.decision === "busy") return calendarResult("busy", claim.record, undefined, "active_lease");
  if (claim.decision === "blocked") return calendarResult("blocked", claim.record, undefined, blockedReason(claim.reason));

  let before: CalendarEventSnapshot;
  try {
    before = CalendarEventSnapshotSchema.parse(await dependencies.calendar.getControlledEvent(action.target));
  } catch (error) {
    if (error instanceof CalendarProviderError && error.kind === "unavailable") {
      return terminalCalendarResult(
        dependencies.executionStore,
        claim.record,
        "retryable_failed",
        request.data.now,
        "provider_unavailable",
        { code: "calendar_unavailable", retryable: true, safeMessage: "The approved Calendar event could not be read before execution." },
      );
    }
    if (error instanceof CalendarProviderError && error.kind === "not_found") {
      return terminalCalendarResult(
        dependencies.executionStore,
        claim.record,
        "conflict",
        request.data.now,
        "provider_not_found",
        { code: "calendar_not_found", retryable: false, safeMessage: "The approved Calendar event no longer exists at the exact target." },
      );
    }
    if (error instanceof CalendarProviderError && error.kind === "conflict") {
      return terminalCalendarResult(
        dependencies.executionStore,
        claim.record,
        "conflict",
        request.data.now,
        "provider_conflict",
        { code: "calendar_preflight_conflict", retryable: false, safeMessage: "The approved Calendar event could not be read without a provider conflict." },
      );
    }
    return terminalCalendarResult(
      dependencies.executionStore,
      claim.record,
      "conflict",
      request.data.now,
      "invalid_snapshot",
      { code: "calendar_invalid_snapshot", retryable: false, safeMessage: "The Calendar preflight response was not a valid controlled event snapshot." },
    );
  }

  const preflightFailure = validatePreflight(before, action, dependencies.configuration);
  if (preflightFailure) {
    return terminalCalendarResult(
      dependencies.executionStore,
      claim.record,
      preflightFailure.status,
      request.data.now,
      preflightFailure.reason,
      preflightFailure.error,
      InitialCalendarBeforeStateSchema.parse({ snapshot: before, approvedPlanVersion: plan.version, approvedPlanDigest: plan.digest }),
    );
  }

  const beforeState = InitialCalendarBeforeStateSchema.parse({
    snapshot: before,
    approvedPlanVersion: plan.version,
    approvedPlanDigest: plan.digest,
  });
  let prepared: ActionExecutionRecord;
  try {
    prepared = await dependencies.executionStore.recordActionState({
      actionExecutionId: claim.record.actionExecutionId,
      status: "in_progress",
      now: request.data.now,
      claimFence: claimFenceFor(claim.record),
      beforeState,
    });
  } catch (error) {
    throw toInitialCalendarServiceError(error, "The approved Calendar before-state could not be persisted; no Calendar write was attempted.");
  }

  const update = CalendarConditionalTimeUpdateSchema.parse({
    ...action.target,
    expectedEtag: action.preconditions.expectedEtag,
    start: action.desired.start,
    end: action.desired.end,
    sendUpdates: action.desired.sendUpdates,
  });
  let after: CalendarEventSnapshot;
  try {
    after = CalendarEventSnapshotSchema.parse(await dependencies.calendar.updateStartEnd(update));
  } catch (error) {
    if (error instanceof CalendarProviderError && error.kind === "conflict") {
      return terminalCalendarResult(
        dependencies.executionStore,
        prepared,
        "conflict",
        request.data.now,
        "provider_conflict",
        { code: "calendar_update_conflict", retryable: false, safeMessage: "The Calendar provider rejected the approved conditional update." },
        beforeState,
      );
    }
    if (error instanceof CalendarProviderError && error.kind === "not_found") {
      return terminalCalendarResult(
        dependencies.executionStore,
        prepared,
        "conflict",
        request.data.now,
        "provider_not_found",
        { code: "calendar_not_found_after_claim", retryable: false, safeMessage: "The approved Calendar event disappeared during execution." },
        beforeState,
      );
    }
    return terminalCalendarResult(
      dependencies.executionStore,
      prepared,
      "conflict",
      request.data.now,
      "calendar_uncertain",
      { code: "calendar_uncertain", retryable: false, safeMessage: "The Calendar update outcome is ambiguous and requires reconciliation." },
      beforeState,
    );
  }

  const afterFailure = validateAfter(after, before, action, dependencies.configuration);
  if (afterFailure) {
    return terminalCalendarResult(
      dependencies.executionStore,
      prepared,
      "conflict",
      request.data.now,
      afterFailure.reason,
      afterFailure.error,
      beforeState,
      InitialCalendarAfterStateSchema.safeParse({ snapshot: after }).success ? { snapshot: after } : undefined,
    );
  }

  const receipt = InitialCalendarMoveReceiptSchema.parse({
    provider: "google_calendar",
    operation: "move",
    providerEventId: after.providerEventId,
    resultingEtag: after.etag,
    verified: true,
  });
  try {
    const succeeded = await dependencies.executionStore.recordActionState({
      actionExecutionId: prepared.actionExecutionId,
      status: "succeeded",
      now: request.data.now,
      claimFence: claimFenceFor(prepared),
      beforeState,
      afterState: InitialCalendarAfterStateSchema.parse({ snapshot: after }),
      receipt,
    });
    return calendarResultFromRecord(succeeded);
  } catch (error) {
    throw toInitialCalendarServiceError(error, "The Calendar moved, but its verified receipt could not be recorded; reconciliation is required.");
  }
}

function validatePreflight(
  snapshot: CalendarEventSnapshot,
  action: CalendarMoveAction,
  configuration: CalendarDemoConfiguration,
): { status: "conflict" | "permanently_failed"; reason: CalendarTerminalReason; error: { code: string; retryable: boolean; safeMessage: string } } | undefined {
  try {
    validateControlledCalendarEventMetadata(snapshot, configuration, action.preconditions.privateTags.region);
  } catch (error) {
    if (error instanceof CalendarDemoValidationError && error.kind === "invalid_configuration") {
      return {
        status: "permanently_failed",
        reason: "invalid_configuration",
        error: { code: "calendar_invalid_configuration", retryable: false, safeMessage: "The configured Calendar identity or allowlist is invalid." },
      };
    }
    return {
      status: "conflict",
      reason: error instanceof CalendarDemoValidationError && error.kind === "invalid_provider_snapshot" ? "invalid_snapshot" : "precondition_changed",
      error: {
        code: error instanceof CalendarDemoValidationError && error.kind === "invalid_provider_snapshot" ? "calendar_invalid_snapshot" : "calendar_precondition_changed",
        retryable: false,
        safeMessage: "The current Calendar event no longer matches the approved controlled-event boundary.",
      },
    };
  }

  const preconditions = action.preconditions;
  const durationMs = Date.parse(snapshot.end.instant) - Date.parse(snapshot.start.instant);
  const matchesApprovedVersion =
    snapshot.calendarId === action.target.calendarId &&
    snapshot.providerEventId === action.target.providerEventId &&
    snapshot.etag === preconditions.expectedEtag &&
    sameZoned(snapshot.start, preconditions.expectedStart) &&
    sameZoned(snapshot.end, preconditions.expectedEnd) &&
    snapshot.organizerDigest === preconditions.organizerDigest &&
    snapshot.attendeeSetDigest === preconditions.attendeeSetDigest &&
    snapshot.eventType === preconditions.eventType &&
    snapshot.recurringEventId === preconditions.recurringEventId &&
    snapshot.ownedByConnectedAccount === preconditions.ownedByConnectedAccount &&
    canonicalJson(snapshot.privateTags) === canonicalJson(preconditions.privateTags) &&
    durationMs === 30 * 60_000;
  if (matchesApprovedVersion) return undefined;
  return {
    status: "conflict",
    reason: "precondition_changed",
    error: { code: "calendar_precondition_changed", retryable: false, safeMessage: "The current Calendar ETag or approved event fields have changed." },
  };
}

function validateAfter(
  after: CalendarEventSnapshot,
  before: CalendarEventSnapshot,
  action: CalendarMoveAction,
  configuration: CalendarDemoConfiguration,
): { reason: CalendarTerminalReason; error: { code: string; retryable: boolean; safeMessage: string } } | undefined {
  try {
    validateControlledCalendarEventMetadata(after, configuration, action.preconditions.privateTags.region);
  } catch (error) {
    return {
      reason: error instanceof CalendarDemoValidationError && error.kind === "invalid_provider_snapshot" ? "invalid_snapshot" : "verification_failed",
      error: {
        code: error instanceof CalendarDemoValidationError && error.kind === "invalid_provider_snapshot" ? "calendar_invalid_snapshot" : "calendar_verification_failed",
        retryable: false,
        safeMessage: "The Calendar provider response did not verify as the approved controlled event.",
      },
    };
  }
  const desired = action.desired;
  const staticFieldsPreserved =
    after.calendarId === before.calendarId &&
    after.providerEventId === before.providerEventId &&
    after.title === before.title &&
    after.company === before.company &&
    after.region === before.region &&
    after.organizerDigest === before.organizerDigest &&
    after.attendeeSetDigest === before.attendeeSetDigest &&
    after.eventType === before.eventType &&
    after.recurringEventId === before.recurringEventId &&
    after.ownedByConnectedAccount === before.ownedByConnectedAccount &&
    canonicalJson(after.privateTags) === canonicalJson(before.privateTags);
  const exactTargetTime = sameZoned(after.start, desired.start) && sameZoned(after.end, desired.end);
  const exactDuration = Date.parse(after.end.instant) - Date.parse(after.start.instant) === desired.durationMinutes * 60_000;
  if (staticFieldsPreserved && exactTargetTime && exactDuration && after.etag !== before.etag) return undefined;
  return {
    reason: "verification_failed",
    error: { code: "calendar_verification_failed", retryable: false, safeMessage: "The Calendar response did not prove an exact start/end-only move with a new ETag." },
  };
}

async function terminalCalendarResult(
  store: ExecutionPersistenceStore,
  current: ActionExecutionRecord,
  status: TerminalCalendarStatus,
  now: string,
  reason: CalendarTerminalReason,
  error: { code: string; retryable: boolean; safeMessage: string },
  beforeState?: InitialCalendarBeforeState,
  afterState?: { snapshot: CalendarEventSnapshot },
): Promise<InitialCalendarExecutionResult> {
  try {
    const record = await store.recordActionState({
      actionExecutionId: current.actionExecutionId,
      status,
      now,
      claimFence: claimFenceFor(current),
      ...(beforeState ? { beforeState } : {}),
      ...(afterState ? { afterState } : {}),
      error,
    });
    return calendarResultFromRecord(record, reason);
  } catch (persistenceError) {
    throw toInitialCalendarServiceError(persistenceError, "The Calendar outcome could not be persisted safely; automatic retry is not allowed.");
  }
}

async function loadVerifiedPlan(planId: string, digest: string, store: ExecutionPersistenceStore): Promise<ExecutionPlan> {
  const plan = await store.getPlan(planId);
  if (!plan) throw new ServiceError("plan_not_found", "The requested immutable plan does not exist.");
  if (plan.digest !== digest) throw new ServiceError("plan_digest_mismatch", "The execution request is not bound to the approved plan digest.");
  return plan;
}

function calendarActionFromPlan(plan: ExecutionPlan): CalendarMoveAction {
  try {
    const payload = VerifiedInitialPlanPayloadSchema.parse(plan.payload);
    if (plan.kind !== "initial" || payload.planId !== plan.planId || payload.taskId !== plan.taskId || payload.version !== plan.version || payload.digest !== plan.digest) {
      throw new Error("execution plan identity mismatch");
    }
    if (payload.actions[1].actionKey !== "initial.calendar.move") throw new Error("calendar action key mismatch");
    return payload.actions[1];
  } catch (error) {
    throw new ServiceError("plan_digest_mismatch", "The approved Calendar action could not be read from the immutable plan.", { cause: error });
  }
}

function calendarReceiptFromRecord(record: ActionExecutionRecord): InitialCalendarMoveReceipt | undefined {
  const parsed = InitialCalendarMoveReceiptSchema.safeParse(record.receipt);
  return parsed.success ? parsed.data : undefined;
}

function claimFenceFor(record: ActionExecutionRecord): { attempts: number; leaseUntil: string } {
  if (record.status !== "in_progress" || !record.leaseUntil) {
    throw new ServiceError("invalid_task_state", "The Calendar action no longer holds a durable execution claim.");
  }
  return { attempts: record.attempts, leaseUntil: record.leaseUntil };
}

function calendarResultFromRecord(
  record: ActionExecutionRecord,
  preferredReason?: InitialCalendarExecutionResult["reason"],
): InitialCalendarExecutionResult {
  if (record.status === "succeeded") {
    const receipt = calendarReceiptFromRecord(record);
    if (!receipt) throw new ServiceError("invalid_task_state", "The durable Calendar success record is missing its matching typed receipt.");
    return calendarResult("succeeded", record, receipt);
  }
  if (record.status === "retryable_failed") return calendarResult("retryable_failed", record, undefined, preferredReason ?? "provider_unavailable");
  if (record.status === "permanently_failed") return calendarResult("permanently_failed", record, undefined, preferredReason ?? "permanently_failed");
  if (record.status === "conflict") return calendarResult("conflict", record, undefined, preferredReason ?? "conflict");
  if (record.status === "delivery_uncertain") return calendarResult("blocked", record, undefined, "reconciliation_required");
  if (record.status === "in_progress") return calendarResult("busy", record, undefined, "active_lease");
  throw new ServiceError("invalid_task_state", "The Calendar action did not persist a terminal state.");
}

function calendarResult(
  decision: InitialCalendarExecutionResult["decision"],
  record: ActionExecutionRecord,
  receipt?: InitialCalendarMoveReceipt,
  reason?: InitialCalendarExecutionResult["reason"],
): InitialCalendarExecutionResult {
  return InitialCalendarExecutionResultSchema.parse({
    contractVersion: "initial-calendar-execution.v1",
    decision,
    record,
    ...(receipt ? { receipt } : {}),
    ...(reason ? { reason } : {}),
  });
}

function blockedReason(reason: "dependency_not_satisfied" | "delivery_uncertain" | "conflict" | "permanently_failed" | "reconciliation_required" | undefined): InitialCalendarExecutionResult["reason"] {
  if (reason === "reconciliation_required") return "reconciliation_required";
  if (reason === "permanently_failed") return "permanently_failed";
  return "conflict";
}

function sameZoned(left: { instant: string; timeZone: string }, right: { instant: string; timeZone: string }): boolean {
  return left.instant === right.instant && left.timeZone === right.timeZone;
}

function toInitialCalendarServiceError(error: unknown, message: string): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof ExecutionPersistenceError) {
    const code = error.code === "plan_not_found" ? "plan_not_found" : error.code === "persistence_failure" ? "provider_unavailable" : "invalid_task_state";
    return new ServiceError(code, message, { cause: error });
  }
  if (error instanceof z.ZodError) return new ServiceError("invalid_task_state", message, { cause: error });
  return new ServiceError("provider_unavailable", message, { cause: error });
}
