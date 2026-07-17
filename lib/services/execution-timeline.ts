import { z } from "zod";
import {
  ExecutionTimelineViewSchema,
  type ExecutionActionView,
  type ExecutionOverallStatus,
  type ExecutionTimelineView,
} from "@/lib/contracts/execution-timeline";
import {
  type ActionExecutionRecord,
  type ExecutionPlan,
} from "@/lib/contracts/execution-persistence";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { OpaqueIdSchema, type TaskStatus, type WorldPrView } from "@/lib/contracts/v1";
import { getExecutionPersistenceStore, getWorldPrStore } from "@/lib/db";
import { ExecutionPersistenceError, type ExecutionPersistenceStore } from "@/lib/db/execution-store";
import { StoreError, type WorldPrStore } from "@/lib/db/store";
import { ServiceError } from "@/lib/services/world-pr";

type InitialActionKey =
  | "initial.artifact.account_brief"
  | "initial.calendar.move"
  | "initial.mail.notify";

const INITIAL_ACTION_LABELS: Record<InitialActionKey, Readonly<{ type: ActionExecutionRecord["type"]; label: string; effect: "recorded_artifact" | "external_effect" }>> = {
  "initial.artifact.account_brief": { type: "artifact.account_brief", label: "Record account brief", effect: "recorded_artifact" },
  "initial.calendar.move": { type: "calendar.move", label: "Move Calendar event", effect: "external_effect" },
  "initial.mail.notify": { type: "mail.notify", label: "Send allowlisted notification", effect: "external_effect" },
};

export type ExecutionTimelineDependencies = Readonly<{
  worldStore?: WorldPrStore;
  executionStore?: ExecutionPersistenceStore;
}>;

export async function getExecutionTimeline(
  worldPrId: string,
  actorId: string,
  dependencies: ExecutionTimelineDependencies = {},
): Promise<ExecutionTimelineView | null> {
  const parsedId = OpaqueIdSchema.safeParse(worldPrId);
  if (!parsedId.success) return null;
  const worldStore = dependencies.worldStore ?? getWorldPrStore();
  const executionStore = dependencies.executionStore ?? getExecutionPersistenceStore();

  try {
    const view = await worldStore.get(parsedId.data, actorId);
    if (!view) return null;
    return await buildExecutionTimeline(view, executionStore);
  } catch (error) {
    throw toExecutionTimelineServiceError(error);
  }
}

async function buildExecutionTimeline(view: WorldPrView, executionStore: ExecutionPersistenceStore): Promise<ExecutionTimelineView> {
  const pointer = view.activePlan?.pointer;
  if (!pointer || pointer.kind !== "initial") {
    return timelineWithoutLedger(view, statusWithoutLedger(view.status), messageWithoutLedger(view.status));
  }

  const plan = await executionStore.getPlan(pointer.planId);
  if (!plan) {
    if (view.status === "preview_ready") {
      return timelineWithoutLedger(
        view,
        "awaiting_approval",
        "Awaiting exact dashboard approval. No action ledger exists and no external action has started.",
        pointer,
      );
    }
    return timelineWithoutLedger(
      view,
      statusWithoutLedger(view.status),
      "The active plan is not available in the durable execution store. No success is claimed.",
      pointer,
    );
  }

  assertPlanMatchesView(plan, view, pointer);
  const payload = parseInitialPayload(plan, view.worldPrId);
  const records = await executionStore.listActions(plan.planId);
  const approval = records.length === 0 ? await executionStore.getApproval(plan.planId) : undefined;
  if (records.length === 0) {
    return timelineWithoutLedger(
      view,
      approval ? "attention_required" : "awaiting_approval",
      approval
        ? "Approval is recorded, but the durable action ledger is incomplete. Execution is stopped."
        : "Awaiting exact dashboard approval. No action ledger exists and no external action has started.",
      pointer,
    );
  }

  const expectedKeys = new Set<string>(payload.executionOrder);
  const orderedRecords = payload.executionOrder
    .map((actionKey) => records.find((record) => record.actionKey === actionKey))
    .filter((record): record is ActionExecutionRecord => record !== undefined);
  const unknownRecords = records.some((record) => !expectedKeys.has(record.actionKey));
  const missingRecords = orderedRecords.length !== payload.executionOrder.length;
  const actions = orderedRecords
    .map(actionViewFromRecord)
    .filter((action): action is ExecutionActionView => action !== null);
  const invalidActionShape = actions.length !== orderedRecords.length;
  const integrityMessage = unknownRecords || missingRecords || invalidActionShape
    ? "The approved action ledger is incomplete or inconsistent. Execution is stopped until it is reconciled."
    : undefined;
  const overallStatus = deriveOverallStatus(view.status, actions.map((action) => action.status), Boolean(integrityMessage));

  return ExecutionTimelineViewSchema.parse({
    contractVersion: "execution-timeline.v1",
    worldPrId: view.worldPrId,
    taskStatus: view.status,
    overallStatus,
    planId: pointer.planId,
    planVersion: pointer.version,
    planDigest: pointer.digest,
    ...(integrityMessage ? { message: integrityMessage } : {}),
    actions,
    updatedAt: latestTimestamp(view.updatedAt, records),
  });
}

function timelineWithoutLedger(
  view: WorldPrView,
  overallStatus: ExecutionOverallStatus,
  message: string,
  pointer?: { planId: string; version: number; digest: string },
): ExecutionTimelineView {
  return ExecutionTimelineViewSchema.parse({
    contractVersion: "execution-timeline.v1",
    worldPrId: view.worldPrId,
    taskStatus: view.status,
    overallStatus,
    ...(pointer ? { planId: pointer.planId, planVersion: pointer.version, planDigest: pointer.digest } : {}),
    message,
    actions: [],
    updatedAt: view.updatedAt,
  });
}

function statusWithoutLedger(status: TaskStatus): ExecutionOverallStatus {
  if (status === "cancelled") return "cancelled";
  if (status === "failed") return "failed";
  if (status === "attention_required") return "attention_required";
  if (status === "preview_ready") return "awaiting_approval";
  if (status === "completed") return "attention_required";
  return "not_started";
}

function messageWithoutLedger(status: TaskStatus): string {
  if (status === "cancelled") return "This World PR was cancelled. No external action is claimed from this view.";
  if (status === "failed") return "Planning failed before approval or external execution. No success is claimed.";
  if (status === "clarification_required") return "Clarification is required before an initial plan or action ledger can exist.";
  if (status === "preview_ready") return "Awaiting exact dashboard approval. No action ledger exists and no external action has started.";
  if (status === "completed") return "The task says completed, but no execution ledger is available. No success is claimed.";
  return "No initial execution ledger is available for this World PR.";
}

function assertPlanMatchesView(
  plan: ExecutionPlan,
  view: WorldPrView,
  pointer: { planId: string; version: number; digest: string },
): void {
  if (plan.kind !== "initial" || plan.taskId !== view.worldPrId || plan.planId !== pointer.planId || plan.version !== pointer.version || plan.digest !== pointer.digest) {
    throw new ServiceError("plan_digest_mismatch", "The durable execution plan no longer matches the active World PR plan.");
  }
}

function parseInitialPayload(plan: ExecutionPlan, worldPrId: string) {
  try {
    const payload = VerifiedInitialPlanPayloadSchema.parse(plan.payload);
    if (payload.taskId !== worldPrId || payload.planId !== plan.planId || payload.version !== plan.version || payload.digest !== plan.digest) throw new Error("initial plan identity mismatch");
    return payload;
  } catch (error) {
    throw new ServiceError("plan_digest_mismatch", "The durable execution plan failed its immutable payload check.", { cause: error });
  }
}

function actionViewFromRecord(record: ActionExecutionRecord): ExecutionActionView | null {
  if (!isInitialActionKey(record.actionKey)) return null;
  const definition = INITIAL_ACTION_LABELS[record.actionKey];
  if (definition.type !== record.type) return null;
  return {
    actionExecutionId: record.actionExecutionId,
    actionKey: record.actionKey,
    type: record.type,
    label: definition.label,
    effect: definition.effect,
    status: record.status,
    attempts: record.attempts,
    startedAt: record.startedAt,
    leaseUntil: record.leaseUntil,
    dispatchStartedAt: record.dispatchStartedAt,
    finishedAt: record.finishedAt,
    ...(record.receipt ? { receipt: record.receipt } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

function isInitialActionKey(value: string): value is InitialActionKey {
  return Object.prototype.hasOwnProperty.call(INITIAL_ACTION_LABELS, value);
}

function deriveOverallStatus(taskStatus: TaskStatus, statuses: readonly ActionExecutionRecord["status"][], ledgerInvalid: boolean): ExecutionOverallStatus {
  if (taskStatus === "cancelled") return "cancelled";
  if (taskStatus === "failed") return "failed";
  if (taskStatus === "attention_required") return "attention_required";
  if (ledgerInvalid) return "attention_required";
  if (statuses.length === 0) return statusWithoutLedger(taskStatus);
  const allSucceeded = statuses.every((status) => status === "succeeded");
  if (taskStatus === "completed" && !allSucceeded) return "attention_required";
  if (allSucceeded) return taskStatus === "completed" ? "completed" : "attention_required";
  if (statuses.some((status) => status === "in_progress")) return "in_progress";
  const succeededCount = statuses.filter((status) => status === "succeeded").length;
  const stopped = statuses.some((status) => status === "delivery_uncertain" || status === "conflict" || status === "permanently_failed" || status === "retryable_failed");
  if (stopped) return succeededCount > 0 ? "partial" : "attention_required";
  if (statuses.every((status) => status === "planned")) return "not_started";
  return "attention_required";
}

function latestTimestamp(viewUpdatedAt: string, records: readonly ActionExecutionRecord[]): string {
  return records.reduce((latest, record) => {
    const candidates = [record.startedAt, record.dispatchStartedAt, record.finishedAt].filter((value): value is string => value !== null);
    return candidates.reduce((innerLatest, candidate) => Date.parse(candidate) > Date.parse(innerLatest) ? candidate : innerLatest, latest);
  }, viewUpdatedAt);
}

function toExecutionTimelineServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof StoreError) {
    const messages: Record<StoreError["code"], string> = {
      forbidden: "This World PR is outside the authenticated workspace scope.",
      idempotency_conflict: "This World PR has conflicting durable request state.",
      scenario_busy: "The controlled demo scenario is already in use.",
      task_not_found: "That World PR does not exist in the current controlled workspace.",
      invalid_task_state: "This World PR cannot expose execution state from its current lifecycle.",
      provider_unavailable: "The configured storage boundary is unavailable; no execution success is claimed.",
      internal_error: "The execution state could not be loaded safely; no execution success is claimed.",
    };
    return new ServiceError(error.code, messages[error.code], { cause: error });
  }
  if (error instanceof ExecutionPersistenceError) {
    if (error.code === "plan_not_found") return new ServiceError("plan_not_found", "The durable execution plan does not exist.", { cause: error });
    if (error.code === "plan_immutable_conflict") return new ServiceError("plan_digest_mismatch", "The durable execution plan is not immutable.", { cause: error });
    return new ServiceError("provider_unavailable", "The execution ledger could not be loaded safely; no execution success is claimed.", { cause: error });
  }
  if (error instanceof z.ZodError) return new ServiceError("invalid_task_state", "The durable execution state failed its strict read contract; no success is claimed.", { cause: error });
  return new ServiceError("provider_unavailable", "The execution state could not be loaded safely; no execution success is claimed.", { cause: error });
}
