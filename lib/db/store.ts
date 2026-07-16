import type {
  CreateWorldPrResponse,
  InitialPlanPayload,
  TaskMutationResponse,
  WorldPrView,
} from "@/lib/contracts/v1";
import { sha256Digest } from "@/lib/domain/digest";

export type StoreErrorCode =
  | "forbidden"
  | "idempotency_conflict"
  | "scenario_busy"
  | "task_not_found"
  | "invalid_task_state"
  | "provider_unavailable"
  | "internal_error";

export class StoreError extends Error {
  constructor(public readonly code: StoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StoreError";
  }
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Persistent storage is not configured for this environment.");
    this.name = "StorageNotConfiguredError";
  }
}

export class FakeProviderConfigurationError extends Error {
  constructor() {
    super("Fixture providers are disabled outside test and development environments.");
    this.name = "FakeProviderConfigurationError";
  }
}

export interface CreateWorldPrStoreInput {
  actorId: string;
  endpoint: string;
  idempotencyKey: string;
  bodyHash: string;
  request: string;
  requestId: string;
  reviewUrl: string;
}

export interface CancelWorldPrStoreInput {
  actorId: string;
  endpoint: string;
  idempotencyKey: string;
  bodyHash: string;
  worldPrId: string;
  requestId: string;
}

export type CreateWorldPrStoreResult = {
  kind: "create";
  view: WorldPrView;
  planPayload?: InitialPlanPayload;
  response: CreateWorldPrResponse;
  replay: boolean;
};

export type CancelWorldPrStoreResult = {
  kind: "cancel";
  view: WorldPrView;
  response: TaskMutationResponse;
  replay: boolean;
};

export interface WorldPrStore {
  createInitial(input: CreateWorldPrStoreInput): Promise<CreateWorldPrStoreResult>;
  get(worldPrId: string, actorId?: string): Promise<WorldPrView | null>;
  getInitialPlanPayload(worldPrId: string, planId: string): Promise<InitialPlanPayload | null>;
  updateView(worldPrId: string, view: WorldPrView): Promise<void>;
  cancel(input: CancelWorldPrStoreInput): Promise<CancelWorldPrStoreResult>;
}

export function requestBodyHash(request: string): string {
  return sha256Digest({ request });
}

export function cancelBodyHash(worldPrId: string): string {
  return sha256Digest({ worldPrId });
}

/**
 * The controlled MVP has one workspace, reached through two distinct
 * principals: the authenticated dashboard operator and the scoped MCP
 * backend token. A World PR created through MCP must be reviewable by that
 * operator, while arbitrary actor identifiers remain isolated in tests and
 * future multi-workspace work.
 */
export function sharesWorldPrScope(ownerActorId: string, requestingActorId: string): boolean {
  if (ownerActorId === requestingActorId) return true;
  const controlledWorkspaceActors = new Set(["demo-operator", "mcp:scoped-token"]);
  return controlledWorkspaceActors.has(ownerActorId) && controlledWorkspaceActors.has(requestingActorId);
}
