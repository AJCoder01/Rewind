import {
  InitialPlanMutationRequestSchema,
  type InitialPlanMutationRequest,
} from "@/lib/contracts/initial-approval";
import {
  ApprovalRecordSchema,
  ExecutionPlanSchema,
  type ApprovalRecord,
  type ExecutionPlan,
} from "@/lib/contracts/execution-persistence";
import {
  InitialPlanViewSchema,
  OpaqueIdSchema,
  TaskMutationResponseSchema,
  WorldPrViewSchema,
  isInitialPlanView,
  type InitialPlanPayload,
  type InitialPlanView,
  type TaskMutationResponse,
  type WorldPrView,
} from "@/lib/contracts/v1";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { getExecutionPersistenceStore, getWorldPrStore } from "@/lib/db";
import {
  ExecutionPersistenceError,
  type ExecutionPersistenceStore,
} from "@/lib/db/execution-store";
import { StoreError, type WorldPrStore } from "@/lib/db/store";
import { sha256Digest } from "@/lib/domain/digest";
import { createOpaqueId } from "@/lib/domain/ids";
import { ServiceError } from "@/lib/services/world-pr";

export type InitialPlanMutationInput = Readonly<{
  actorId: string;
  source: "dashboard" | "mcp";
  idempotencyKey: string;
  requestId?: string;
  worldPrId: string;
  request: unknown;
}>;

export type InitialPlanServiceDependencies = Readonly<{
  worldStore?: WorldPrStore;
  executionStore?: ExecutionPersistenceStore;
  now?: () => Date;
}>;

export type InitialReplanInput = InitialPlanMutationInput & Readonly<{
  /** Test-only/provider-boundary injection. HTTP callers cannot supply a plan payload. */
  nextPayload?: unknown;
}>;

const APPROVAL_LABEL = "Initial plan approved; no external action has started.";
const REPLAN_LABEL = "Initial preview superseded with a new immutable plan version.";

export async function approveInitialPlan(
  input: InitialPlanMutationInput,
  dependencies: InitialPlanServiceDependencies = {},
): Promise<{ response: TaskMutationResponse; view: WorldPrView; replay: boolean }> {
  try {
    const parsedRequest = parseMutationRequest(input);
    assertDashboardApproval(input);
    const worldStore = dependencies.worldStore ?? getWorldPrStore();
    const executionStore = dependencies.executionStore ?? getExecutionPersistenceStore();
    const current = await loadCurrentInitialView(worldStore, input.worldPrId, input.actorId);
    assertCurrentPointer(current, parsedRequest);
    const payload = await loadPayload(worldStore, current, parsedRequest);
    const plan = await buildExecutionPlan(payload, executionStore, dependencies.now ?? (() => new Date()));
    await executionStore.createPlan(plan);

    const existing = await executionStore.getApproval(plan.planId);
    if (existing) {
      assertReplayApproval(existing, input.actorId, parsedRequest);
      const repaired = await ensureApprovalTimeline(worldStore, current, existing);
      return mutationResult(repaired, input.requestId, true);
    }

    if (current.status !== "preview_ready") {
      throw new ServiceError("invalid_task_state", "Only an unapproved preview can receive the initial approval.");
    }
    const approval = ApprovalRecordSchema.parse({
      approvalId: createOpaqueId("appr_"),
      planId: plan.planId,
      planVersion: plan.version,
      planDigest: plan.digest,
      actorId: input.actorId,
      approvedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
    let persisted: { approval: ApprovalRecord; replay: boolean };
    try {
      persisted = await executionStore.createApproval(approval);
    } catch (error) {
      if (!(error instanceof ExecutionPersistenceError) || error.code !== "approval_conflict") throw error;
      const raced = await executionStore.getApproval(plan.planId);
      if (!raced) throw error;
      assertReplayApproval(raced, input.actorId, parsedRequest);
      const repaired = await ensureApprovalTimeline(worldStore, current, raced);
      return mutationResult(repaired, input.requestId, true);
    }
    const nextView = await ensureApprovalTimeline(worldStore, current, persisted.approval);
    return mutationResult(nextView, input.requestId, persisted.replay);
  } catch (error) {
    throw toInitialServiceError(error);
  }
}

export async function replanInitialPlan(
  input: InitialReplanInput,
  dependencies: InitialPlanServiceDependencies = {},
): Promise<{ response: TaskMutationResponse; view: WorldPrView; replay: boolean }> {
  try {
    const parsedRequest = parseMutationRequest(input);
    assertDashboardApproval(input);
    const worldStore = dependencies.worldStore ?? getWorldPrStore();
    const executionStore = dependencies.executionStore ?? getExecutionPersistenceStore();
    const now = dependencies.now ?? (() => new Date());
    const current = await loadCurrentInitialView(worldStore, input.worldPrId, input.actorId);
    assertCurrentPointer(current, parsedRequest);
    if (current.status !== "preview_ready") {
      throw new ServiceError("invalid_task_state", "Only an unapproved preview can be replanned.");
    }
    const currentPayload = await loadPayload(worldStore, current, parsedRequest);
    const existingApproval = await executionStore.getApproval(parsedRequest.planId);
    if (existingApproval) {
      throw new ServiceError("invalid_task_state", "An approved plan cannot be replanned; create a new review from current provider state.");
    }
    if ((await executionStore.listActions(parsedRequest.planId)).length > 0) {
      throw new ServiceError("invalid_task_state", "A plan with durable action state cannot be replanned.");
    }

    const nextPayload = input.nextPayload === undefined
      ? supersedeInitialPlanPayload(currentPayload, createOpaqueId("plan_"))
      : parseNextPayload(input.nextPayload, currentPayload);
    const nextPlanView = initialPlanViewFromPayload(nextPayload);
    const nextView = appendTimeline(current, {
      eventId: createOpaqueId("evt_"),
      type: "plan.superseded",
      occurredAt: now().toISOString(),
      label: REPLAN_LABEL,
      status: "preview_ready",
    }, nextPlanView);
    await worldStore.persistInitialPlanVersion(input.worldPrId, nextPayload, nextView);
    return mutationResult(nextView, input.requestId, false);
  } catch (error) {
    throw toInitialServiceError(error);
  }
}

export function initialPlanViewFromPayload(payload: InitialPlanPayload): InitialPlanView {
  const parsed = VerifiedInitialPlanPayloadSchema.parse(payload);
  const selected = parsed.candidateSet.find((candidate) => candidate.candidateId === parsed.selectedCandidateId);
  const alternative = parsed.candidateSet.find((candidate) => candidate.candidateId === parsed.alternativeCandidateIds[0]);
  if (!selected || !alternative) throw new ServiceError("plan_digest_mismatch", "The approved plan does not contain its closed candidate set.");
  return InitialPlanViewSchema.parse({
    pointer: { planId: parsed.planId, kind: "initial", version: parsed.version, digest: parsed.digest },
    selectedCandidate: { candidateId: selected.candidateId, label: selected.title },
    alternatives: [{ candidateId: alternative.candidateId, label: alternative.title }],
    candidateEvidence: parsed.candidateSet.map((candidate) => ({
      candidateId: candidate.candidateId,
      label: candidate.title,
      region: candidate.region,
      start: candidate.start,
      end: candidate.end,
      rankingEvidence: candidate.rankingEvidence,
    })) as InitialPlanView["candidateEvidence"],
    assumptions: parsed.assumptions,
    actions: parsed.actions,
  });
}

export function supersedeInitialPlanPayload(payload: InitialPlanPayload, planId: string): InitialPlanPayload {
  const parsed = VerifiedInitialPlanPayloadSchema.parse(payload);
  const nextPlanId = OpaqueIdSchema.parse(planId);
  const core = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "digest" && key !== "planId" && key !== "version"));
  const nextCore = { ...core, planId: nextPlanId, version: parsed.version + 1 };
  return VerifiedInitialPlanPayloadSchema.parse({ ...nextCore, digest: sha256Digest(nextCore) });
}

function parseMutationRequest(input: InitialPlanMutationInput): InitialPlanMutationRequest {
  if (!input.idempotencyKey || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) {
    throw new ServiceError("invalid_request", "Idempotency-Key is required and must be between 16 and 200 characters.");
  }
  const parsed = InitialPlanMutationRequestSchema.safeParse(input.request);
  if (!parsed.success) throw new ServiceError("invalid_request", "The request must identify the exact initial plan version and digest.");
  return parsed.data;
}

function assertDashboardApproval(input: InitialPlanMutationInput): void {
  if (input.source !== "dashboard") throw new ServiceError("forbidden", "MCP may create a World PR but cannot approve or replan it.");
}

async function loadCurrentInitialView(worldStore: WorldPrStore, worldPrId: string, actorId: string): Promise<WorldPrView> {
  const parsedId = OpaqueIdSchema.safeParse(worldPrId);
  if (!parsedId.success) throw new ServiceError("invalid_request", "The World PR identifier is invalid.");
  const view = await worldStore.get(parsedId.data, actorId);
  if (!view) throw new ServiceError("task_not_found", "That World PR does not exist in the current controlled workspace.");
  if (!view.activePlan || !isInitialPlanView(view.activePlan)) {
    throw new ServiceError("plan_not_found", "That World PR does not have an active initial plan.");
  }
  return WorldPrViewSchema.parse(view);
}

function assertCurrentPointer(view: WorldPrView, request: InitialPlanMutationRequest): void {
  if (!view.activePlan || !isInitialPlanView(view.activePlan)) throw new ServiceError("plan_not_found", "That World PR does not have an active initial plan.");
  const pointer = view.activePlan.pointer;
  if (pointer.planId !== request.planId || pointer.version !== request.planVersion || pointer.digest !== request.planDigest) {
    throw new ServiceError("plan_digest_mismatch", "The requested plan is no longer the active immutable preview.");
  }
}

async function loadPayload(worldStore: WorldPrStore, view: WorldPrView, request: InitialPlanMutationRequest): Promise<InitialPlanPayload> {
  const payload = await worldStore.getInitialPlanPayload(view.worldPrId, request.planId);
  if (!payload) throw new ServiceError("plan_not_found", "The requested immutable plan does not exist.");
  try {
    const parsed = VerifiedInitialPlanPayloadSchema.parse(payload);
    if (parsed.taskId !== view.worldPrId || parsed.planId !== request.planId || parsed.version !== request.planVersion || parsed.digest !== request.planDigest) {
      throw new Error("plan identity mismatch");
    }
    return parsed;
  } catch {
    throw new ServiceError("plan_digest_mismatch", "The stored plan failed its immutable digest or identity check.");
  }
}

async function buildExecutionPlan(payload: InitialPlanPayload, executionStore: ExecutionPersistenceStore, now: () => Date): Promise<ExecutionPlan> {
  const existing = await executionStore.getPlan(payload.planId);
  return ExecutionPlanSchema.parse({
    planId: payload.planId,
    taskId: payload.taskId,
    kind: "initial",
    version: payload.version,
    schemaVersion: payload.schemaVersion,
    promptVersion: payload.modelMetadata.promptVersion,
    model: payload.modelMetadata.model,
    payload,
    digest: payload.digest,
    createdAt: existing?.createdAt ?? now().toISOString(),
  });
}

function assertReplayApproval(approval: ApprovalRecord, actorId: string, request: InitialPlanMutationRequest): void {
  if (approval.actorId !== actorId) throw new ServiceError("forbidden", "This immutable plan already has an approval from another authenticated operator.");
  if (approval.planId !== request.planId || approval.planVersion !== request.planVersion || approval.planDigest !== request.planDigest) {
    throw new ServiceError("plan_digest_mismatch", "The stored approval is bound to a different immutable plan version.");
  }
}

async function ensureApprovalTimeline(worldStore: WorldPrStore, current: WorldPrView, approval: ApprovalRecord): Promise<WorldPrView> {
  if (current.timeline.some((item) => item.type === "approval.recorded" && item.label === APPROVAL_LABEL)) return current;
  const nextView = appendTimeline(current, {
    eventId: `evt_${approval.approvalId}`,
    type: "approval.recorded",
    occurredAt: approval.approvedAt,
    label: APPROVAL_LABEL,
    status: "preview_ready",
  });
  await worldStore.updateView(current.worldPrId, nextView);
  return nextView;
}

function appendTimeline(view: WorldPrView, item: WorldPrView["timeline"][number], activePlan?: InitialPlanView): WorldPrView {
  return WorldPrViewSchema.parse({
    ...view,
    ...(activePlan ? { activePlan } : {}),
    timeline: [...view.timeline, item],
    updatedAt: item.occurredAt,
  });
}

function parseNextPayload(value: unknown, current: InitialPlanPayload): InitialPlanPayload {
  try {
    const parsed = VerifiedInitialPlanPayloadSchema.parse(value);
    if (parsed.taskId !== current.taskId || parsed.version !== current.version + 1 || parsed.planId === current.planId) throw new Error("next plan identity mismatch");
    return parsed;
  } catch {
    throw new ServiceError("plan_digest_mismatch", "The replacement plan failed its immutable identity or digest check.");
  }
}

function mutationResult(view: WorldPrView, requestId: string | undefined, replay: boolean): { response: TaskMutationResponse; view: WorldPrView; replay: boolean } {
  const response = TaskMutationResponseSchema.parse({
    worldPrId: view.worldPrId,
    status: view.status,
    ...(view.activePlan ? { activePlan: view.activePlan.pointer } : {}),
    ...(view.attention ? { attention: view.attention } : {}),
    requestId: requestId ?? createOpaqueId("req_"),
  });
  return { response, view, replay };
}

function toInitialServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof StoreError) {
    const messages: Record<StoreError["code"], string> = {
      forbidden: "This World PR is outside the authenticated workspace scope.",
      idempotency_conflict: "This idempotency key was already used for a different request.",
      scenario_busy: "The controlled demo scenario is already in use.",
      task_not_found: "That World PR does not exist in the current controlled workspace.",
      invalid_task_state: "This World PR cannot be changed from its current state.",
      provider_unavailable: "The configured storage or provider boundary is unavailable; no external action was attempted.",
      internal_error: "The request could not be recorded safely; no external action was attempted.",
    };
    return new ServiceError(error.code, messages[error.code], { cause: error });
  }
  if (error instanceof ExecutionPersistenceError) {
    const mapped: Record<ExecutionPersistenceError["code"], { code: ServiceError["code"]; message: string }> = {
      plan_immutable_conflict: { code: "plan_digest_mismatch", message: "The immutable plan already contains different content." },
      plan_not_found: { code: "plan_not_found", message: "The requested immutable plan does not exist." },
      approval_conflict: { code: "invalid_task_state", message: "This immutable plan already has a different approval." },
      action_immutable_conflict: { code: "invalid_task_state", message: "The immutable plan already has different durable action state." },
      action_not_found: { code: "invalid_task_state", message: "The immutable plan has missing durable action state." },
      action_not_claimable: { code: "invalid_task_state", message: "The immutable plan is not in a safe state for this operation." },
      lease_reconciliation_required: { code: "invalid_task_state", message: "The immutable plan requires durable provider reconciliation before it can change." },
      persistence_failure: { code: "provider_unavailable", message: "The immutable plan could not be recorded safely; no external action was attempted." },
    };
    const safe = mapped[error.code];
    return new ServiceError(safe.code, safe.message, { cause: error });
  }
  return new ServiceError("internal_error", "The immutable plan change could not be recorded safely; no external action was attempted.", { cause: error });
}
