import {
  CancelWorldPrRequestSchema,
  CreateWorldPrRequestSchema,
  McpWorldPrStatusSchema,
  OpaqueIdSchema,
  type CreateWorldPrResponse,
  type McpWorldPrStatus,
  type TaskMutationResponse,
  type WorldPrView,
} from "@/lib/contracts/v1";
import { getWorldPrStore } from "@/lib/db";
import { getExecutionPersistenceStore } from "@/lib/db";
import { ExecutionPersistenceError } from "@/lib/db/execution-store";
import {
  cancelBodyHash,
  FakeProviderConfigurationError,
  requestBodyHash,
  StorageNotConfiguredError,
  StoreError,
  type CancelWorldPrStoreResult,
} from "@/lib/db/store";
import { createOpaqueId } from "@/lib/domain/ids";
import { isSupportedScenarioRequest } from "@/lib/domain/scenario";

export type ServiceErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "unsupported_request"
  | "idempotency_conflict"
  | "scenario_busy"
  | "task_not_found"
  | "invalid_task_state"
  | "plan_not_found"
  | "plan_digest_mismatch"
  | "plan_stale"
  | "approval_required"
  | "candidate_set_invalid"
  | "model_output_invalid"
  | "unknown_entity"
  | "unknown_action"
  | "unknown_template"
  | "recipient_not_allowed"
  | "provider_conflict"
  | "delivery_uncertain"
  | "action_not_retryable"
  | "reset_conflict"
  | "provider_unavailable"
  | "internal_error";

export class ServiceError extends Error {
  constructor(public readonly code: ServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ServiceError";
  }
}

export type CreateWorldPrInput = {
  actorId: string;
  source: "dashboard" | "mcp";
  idempotencyKey: string;
  requestId?: string;
  request: unknown;
};

export type CancelWorldPrInput = {
  actorId: string;
  source: "dashboard" | "mcp";
  idempotencyKey: string;
  requestId?: string;
  worldPrId: string;
  request: unknown;
};

export async function createWorldPr(input: CreateWorldPrInput): Promise<{ response: CreateWorldPrResponse; view: WorldPrView; replay: boolean }> {
  const parsed = CreateWorldPrRequestSchema.safeParse(input.request);
  if (!parsed.success) throw new ServiceError("invalid_request", "Request must contain one supported task description.");
  if (!isSupportedScenarioRequest(parsed.data.request)) {
    throw new ServiceError("unsupported_request", "This demo supports only the controlled Acme Calendar, mail, and account-brief scenario.");
  }
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const requestId = input.requestId ?? createOpaqueId("req_");
  const reviewUrl = makeReviewUrl();
  try {
    const result = await getWorldPrStore().createInitial({
      actorId: input.actorId,
      endpoint: "POST /api/v1/world-prs",
      idempotencyKey,
      bodyHash: requestBodyHash(parsed.data.request),
      request: parsed.data.request,
      requestId,
      reviewUrl,
    });
    return result;
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function getWorldPr(worldPrId: string, actorId?: string): Promise<WorldPrView | null> {
  const parsedId = OpaqueIdSchema.safeParse(worldPrId);
  if (!parsedId.success) return null;
  try {
    return await getWorldPrStore().get(parsedId.data, actorId);
  } catch (error) {
    throw toServiceError(error);
  }
}

export async function getWorldPrStatus(worldPrId: string, actorId?: string): Promise<McpWorldPrStatus | null> {
  const view = await getWorldPr(worldPrId, actorId);
  if (!view) return null;
  return McpWorldPrStatusSchema.parse({
    worldPrId: view.worldPrId,
    status: view.status,
    reviewUrl: makeReviewUrl().replace("{worldPrId}", view.worldPrId),
    ...(view.clarification ? { clarification: view.clarification } : {}),
    ...(view.attention ? { attention: view.attention } : {}),
  });
}

export async function cancelWorldPr(input: CancelWorldPrInput): Promise<{ response: TaskMutationResponse; view: WorldPrView; replay: boolean }> {
  const parsed = CancelWorldPrRequestSchema.safeParse(input.request);
  if (!parsed.success) throw new ServiceError("invalid_request", "Cancellation accepts an empty JSON object only.");
  const id = OpaqueIdSchema.safeParse(input.worldPrId);
  if (!id.success) throw new ServiceError("invalid_request", "The World PR identifier is invalid.");
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const requestId = input.requestId ?? createOpaqueId("req_");
  try {
    const current = await getWorldPrStore().get(id.data, input.actorId);
    if (!current) throw new ServiceError("task_not_found", "That World PR does not exist in the current controlled workspace.");
    if (current.activePlan?.pointer.kind === "initial") {
      const approval = await getExecutionPersistenceStore().getApproval(current.activePlan.pointer.planId);
      if (approval) throw new ServiceError("invalid_task_state", "An approved plan cannot be cancelled before its durable execution state is resolved.");
    }
    const result: CancelWorldPrStoreResult = await getWorldPrStore().cancel({
      actorId: input.actorId,
      endpoint: `POST /api/v1/world-prs/${id.data}/cancel`,
      idempotencyKey,
      bodyHash: cancelBodyHash(id.data),
      worldPrId: id.data,
      requestId,
    });
    return result;
  } catch (error) {
    throw toServiceError(error);
  }
}

function requireIdempotencyKey(value: string): string {
  if (!value || value.length < 16 || value.length > 200) {
    throw new ServiceError("invalid_request", "Idempotency-Key is required and must be between 16 and 200 characters.");
  }
  return value;
}

function makeReviewUrl(): string {
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) throw new ServiceError("provider_unavailable", "The review service is not configured; no plan was created.");
  try {
    return `${new URL(appBaseUrl).origin}/pr/{worldPrId}`;
  } catch {
    throw new ServiceError("provider_unavailable", "The review service is not configured; no plan was created.");
  }
}

function toServiceError(error: unknown): ServiceError {
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
  if (error instanceof StorageNotConfiguredError || error instanceof FakeProviderConfigurationError) {
    return new ServiceError("provider_unavailable", "The configured storage or provider boundary is unavailable; no external action was attempted.", { cause: error });
  }
  if (error instanceof ExecutionPersistenceError) {
    const messages: Record<ExecutionPersistenceError["code"], string> = {
      plan_immutable_conflict: "The immutable plan already contains different content.",
      plan_not_found: "The requested immutable plan does not exist.",
      approval_conflict: "This immutable plan already has a different approval.",
      action_immutable_conflict: "The immutable plan already has different durable action state.",
      action_not_found: "The immutable plan has missing durable action state.",
      action_not_claimable: "The immutable plan is not in a safe state for this operation.",
      lease_reconciliation_required: "The immutable plan requires durable provider reconciliation before it can change.",
      persistence_failure: "The request could not be recorded safely; no external action was attempted.",
    };
    return new ServiceError(error.code === "plan_not_found" ? "plan_not_found" : "provider_unavailable", messages[error.code], { cause: error });
  }
  return new ServiceError("internal_error", "The request could not be recorded safely; no external action was attempted.", { cause: error });
}
