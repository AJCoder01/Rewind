import { z } from "zod";
import {
  InitialActionClaimResultSchema,
  InitialActionPreparationSchema,
  type InitialActionClaimResult,
  type InitialActionPreparation,
} from "@/lib/contracts/initial-execution";
import {
  ExecutionPlanSchema,
  type ActionExecutionRecord,
  type ExecutionPlan,
} from "@/lib/contracts/execution-persistence";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { OpaqueIdSchema, type InitialPlanPayload } from "@/lib/contracts/v1";
import {
  ExecutionPersistenceError,
  type PlannedActionInput,
  type ExecutionPersistenceStore,
} from "@/lib/db/execution-store";
import { ServiceError } from "@/lib/services/world-pr";

const InitialActionKeySchema = z.enum([
  "initial.artifact.account_brief",
  "initial.calendar.move",
  "initial.mail.notify",
]);

const InitialClaimRequestSchema = z
  .object({
    actorId: z.string().min(1).max(200),
    source: z.enum(["dashboard", "mcp"]),
    planId: OpaqueIdSchema,
    planDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    actionKey: InitialActionKeySchema,
    now: z.string().datetime({ offset: true }),
    leaseUntil: z.string().datetime({ offset: true }),
    dispatchStartedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type InitialActionPreparationDependencies = Readonly<{
  now?: () => Date;
}>;

export type InitialActionClaimInput = z.infer<typeof InitialClaimRequestSchema>;

export async function ensureInitialActionRows(
  planId: string,
  executionStore: ExecutionPersistenceStore,
  dependencies: InitialActionPreparationDependencies = {},
): Promise<InitialActionPreparation> {
  const parsedPlanId = OpaqueIdSchema.safeParse(planId);
  if (!parsedPlanId.success) throw new ServiceError("invalid_request", "The immutable plan identifier is invalid.");
  try {
    const plan = await executionStore.getPlan(parsedPlanId.data);
    if (!plan) throw new ServiceError("plan_not_found", "The requested immutable plan does not exist.");
    return await prepareInitialActionRows(plan, executionStore, dependencies);
  } catch (error) {
    throw toInitialExecutionServiceError(error);
  }
}

export async function prepareInitialActionRows(
  plan: ExecutionPlan,
  executionStore: ExecutionPersistenceStore,
  dependencies: InitialActionPreparationDependencies = {},
): Promise<InitialActionPreparation> {
  const parsedPlan = ExecutionPlanSchema.parse(plan);
  const payload = parseInitialPlanPayload(parsedPlan);
  const inputs = plannedActionsFor(payload);
  try {
    const actions = await executionStore.ensureActionRows(inputs);
    return InitialActionPreparationSchema.parse({
      contractVersion: "initial-execution.v1",
      planId: parsedPlan.planId,
      actions,
      preparedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
  } catch (error) {
    throw toInitialExecutionServiceError(error);
  }
}

export async function claimApprovedInitialAction(
  input: InitialActionClaimInput,
  executionStore: ExecutionPersistenceStore,
): Promise<InitialActionClaimResult> {
  const parsedRequest = InitialClaimRequestSchema.safeParse(input);
  if (!parsedRequest.success) throw new ServiceError("invalid_request", "The execution request did not match the strict initial action contract.");
  const request = parsedRequest.data;
  if (request.source !== "dashboard") throw new ServiceError("forbidden", "MCP may not approve or execute a World PR.");
  const plan = await executionStore.getPlan(request.planId);
  if (!plan) throw new ServiceError("plan_not_found", "The requested immutable plan does not exist.");
  if (plan.digest !== request.planDigest) throw new ServiceError("plan_digest_mismatch", "The execution request is not bound to the approved plan digest.");
  const approval = await executionStore.getApproval(plan.planId);
  if (!approval) throw new ServiceError("approval_required", "The exact initial plan must be approved before execution.");
  if (approval.actorId !== request.actorId) throw new ServiceError("forbidden", "This plan was approved by a different authenticated operator.");
  if (approval.planVersion !== plan.version || approval.planDigest !== plan.digest) {
    throw new ServiceError("plan_digest_mismatch", "The approval is not bound to the immutable execution plan.");
  }

  const payload = parseInitialPlanPayload(plan);
  const actions = await executionStore.listActions(plan.planId);
  const action = actions.find((candidate) => candidate.actionKey === request.actionKey);
  if (!action) throw new ServiceError("invalid_task_state", "The approved plan has not been prepared with its complete action ledger.");

  if (action.status === "succeeded") return claimResult("skipped", action);
  if (action.status === "delivery_uncertain") return claimResult("blocked", action, "delivery_uncertain");
  if (action.status === "conflict") return claimResult("blocked", action, "conflict");
  if (action.status === "permanently_failed") return claimResult("blocked", action, "permanently_failed");
  if (action.status === "in_progress") {
    if (action.leaseUntil && Date.parse(action.leaseUntil) > Date.parse(request.now)) return claimResult("busy", action);
    try {
      const reconciled = await executionStore.reconcileExpiredLease(action.actionExecutionId, request.now);
      if (reconciled.status === "succeeded") return claimResult("skipped", reconciled);
      if (reconciled.status === "in_progress") return claimResult("busy", reconciled);
      if (reconciled.status === "delivery_uncertain") return claimResult("blocked", reconciled, "delivery_uncertain");
      if (reconciled.status === "permanently_failed") return claimResult("blocked", reconciled, "permanently_failed");
      if (reconciled.status === "conflict") {
        return claimResult("blocked", reconciled, reconciled.error?.code === "reconciliation_required" ? "reconciliation_required" : "conflict");
      }
      throw new ServiceError("action_not_retryable", "The expired action did not reconcile to a durable terminal state.");
    } catch (error) {
      if (error instanceof ExecutionPersistenceError && error.code === "lease_reconciliation_required") return claimResult("blocked", action, "reconciliation_required");
      throw toInitialExecutionServiceError(error);
    }
  }

  if (action.status === "planned" || action.status === "retryable_failed") {
    assertDependenciesSatisfied(payload, actions, action);
    if ((action.type === "mail.notify" || action.type === "mail.correct") && !request.dispatchStartedAt) {
      throw new ServiceError("invalid_request", "Gmail execution requires a persisted dispatch marker before handoff.");
    }
    try {
      const claimed = await executionStore.claimAction({
        actionExecutionId: action.actionExecutionId,
        now: request.now,
        leaseUntil: request.leaseUntil,
        ...(request.dispatchStartedAt ? { dispatchStartedAt: request.dispatchStartedAt } : {}),
      });
      if (claimed.claimed) return claimResult("claimed", claimed.record);
      if (claimed.record.status === "succeeded") return claimResult("skipped", claimed.record);
      if (claimed.record.status === "in_progress") return claimResult("busy", claimed.record);
      if (claimed.record.status === "delivery_uncertain") return claimResult("blocked", claimed.record, "delivery_uncertain");
      if (claimed.record.status === "conflict") return claimResult("blocked", claimed.record, "conflict");
      if (claimed.record.status === "permanently_failed") return claimResult("blocked", claimed.record, "permanently_failed");
      throw new ServiceError("action_not_retryable", "The action was not claimed because its durable state is no longer retryable.");
    } catch (error) {
      throw toInitialExecutionServiceError(error);
    }
  }

  throw new ServiceError("action_not_retryable", "The action is not in an explicitly safe state for execution.");
}

function parseInitialPlanPayload(plan: ExecutionPlan): InitialPlanPayload {
  try {
    const payload = VerifiedInitialPlanPayloadSchema.parse(plan.payload);
    if (plan.kind !== "initial" || payload.planId !== plan.planId || payload.taskId !== plan.taskId || payload.version !== plan.version || payload.digest !== plan.digest) {
      throw new Error("execution plan identity mismatch");
    }
    return payload;
  } catch {
    throw new ServiceError("plan_digest_mismatch", "The execution plan failed its immutable payload check.");
  }
}

function plannedActionsFor(payload: InitialPlanPayload): PlannedActionInput[] {
  return payload.actions.map((action) => ({
    planId: payload.planId,
    actionKey: action.actionKey,
    type: action.type,
    targetRef: targetRefFor(action),
    operationKey: `${payload.planId}:${action.actionKey}`,
    action: action as unknown as Record<string, unknown>,
  }));
}

function targetRefFor(action: InitialPlanPayload["actions"][number]): string {
  if (action.type === "artifact.account_brief") return "artifact:account-brief";
  if (action.type === "calendar.move") return `calendar:${action.target.calendarId}:${action.target.providerEventId}`;
  return `gmail:run:${action.desired.runId}`;
}

function assertDependenciesSatisfied(payload: InitialPlanPayload, actions: readonly ActionExecutionRecord[], action: ActionExecutionRecord): void {
  const index = payload.executionOrder.indexOf(action.actionKey as (typeof payload.executionOrder)[number]);
  if (index < 0) throw new ServiceError("unknown_action", "The action is not in the approved execution order.");
  const priorKeys: ReadonlySet<string> = new Set<string>(payload.executionOrder.slice(0, index));
  const actionsByKey = new Map(actions.map((candidate) => [candidate.actionKey, candidate]));
  const unsatisfied = [...priorKeys].some((key) => actionsByKey.get(key)?.status !== "succeeded");
  if (unsatisfied) throw new ServiceError("invalid_task_state", "The approved action order requires every earlier action ledger row to exist and succeed first.");
}

function claimResult(decision: InitialActionClaimResult["decision"], record: ActionExecutionRecord, reason?: InitialActionClaimResult["reason"]): InitialActionClaimResult {
  return InitialActionClaimResultSchema.parse({
    contractVersion: "initial-execution.v1",
    decision,
    record,
    ...(reason ? { reason } : {}),
  });
}

function toInitialExecutionServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof ExecutionPersistenceError) {
    const mapped: Record<ExecutionPersistenceError["code"], { code: ServiceError["code"]; message: string }> = {
      plan_immutable_conflict: { code: "plan_digest_mismatch", message: "The immutable execution plan already contains different content." },
      plan_not_found: { code: "plan_not_found", message: "The requested immutable plan does not exist." },
      approval_conflict: { code: "invalid_task_state", message: "The plan already has a different immutable approval." },
      action_immutable_conflict: { code: "invalid_task_state", message: "The action ledger already contains different immutable content." },
      action_not_found: { code: "invalid_task_state", message: "The action ledger row does not exist." },
      action_not_claimable: { code: "action_not_retryable", message: "The action is not in an explicitly safe state for execution." },
      lease_reconciliation_required: { code: "provider_conflict", message: "Provider state must be reconciled before a non-mail action can be retried." },
      persistence_failure: { code: "provider_unavailable", message: "The action ledger could not be persisted safely; no external action was attempted." },
    };
    const safe = mapped[error.code];
    return new ServiceError(safe.code, safe.message, { cause: error });
  }
  if (error instanceof z.ZodError) return new ServiceError("invalid_request", "The execution request did not match the strict initial action contract.", { cause: error });
  return new ServiceError("internal_error", "The initial action ledger could not be updated safely; no external action was attempted.", { cause: error });
}
