import {
  CancelWorldPrRequestSchema,
  CreateWorldPrResponseSchema,
  TaskMutationResponseSchema,
  WorldPrViewSchema,
  type WorldPrView,
} from "@/lib/contracts/v1";
import { buildFixtureAnalyzingView, buildFixtureClarificationView, buildFixtureWorldPrRecord, buildPlanningLeaseExpiredView } from "@/lib/domain/fixture-world-pr";
import {
  FakeProviderConfigurationError,
  StoreError,
  type CancelWorldPrStoreInput,
  type CancelWorldPrStoreResult,
  type CreateWorldPrStoreInput,
  type CreateWorldPrStoreResult,
  type WorldPrStore,
  sharesWorldPrScope,
} from "@/lib/db/store";

type IdempotencyRecord =
  | { bodyHash: string; status: "in_progress"; result: CreateWorldPrStoreResult | CancelWorldPrStoreResult }
  | { bodyHash: string; status: "completed"; result: CreateWorldPrStoreResult | CancelWorldPrStoreResult }
  | { bodyHash: string; status: "failed"; error: StoreError };

type ScenarioLock = {
  worldPrId: string;
  leaseUntil: number;
  executionStarted: boolean;
};

export class MemoryFixtureWorldPrStore implements WorldPrStore {
  private readonly byWorldPrId = new Map<string, WorldPrView>();
  private readonly byOwner = new Map<string, string>();
  private readonly byIdempotency = new Map<string, IdempotencyRecord>();
  private scenarioLock: ScenarioLock | undefined;
  private activeRule = false;
  private planningDelayMs = 0;
  private nextPlanningFailure: StoreError | undefined;

  async createInitial(input: CreateWorldPrStoreInput): Promise<CreateWorldPrStoreResult> {
    if (process.env.NODE_ENV === "production") throw new FakeProviderConfigurationError();

    const idempotencyId = idempotencyIdFor(input.actorId, input.endpoint, input.idempotencyKey);
    const existing = this.byIdempotency.get(idempotencyId);
    if (existing) {
      if (existing.bodyHash !== input.bodyHash) throw new StoreError("idempotency_conflict", "This idempotency key was already used for a different request.");
      if (existing.status === "failed") throw new StoreError(existing.error.code, existing.error.message);
      if (existing.status === "in_progress") {
        if (existing.result.kind === "cancel") throw new StoreError("internal_error", "A cancellation is already being processed.");
        const response = CreateWorldPrResponseSchema.parse({ ...existing.result.response, status: "analyzing", replayPending: true });
        return { ...existing.result, response, replay: true };
      }
      if (existing.result.kind === "cancel") throw new StoreError("internal_error", "The idempotency record does not match a create request.");
      return { ...existing.result, replay: true };
    }

    const record = buildFixtureWorldPrRecord(input.request);
    const analyzingView = buildFixtureAnalyzingView(record.view);
    const pendingResult: CreateWorldPrStoreResult & { kind: "create" } = {
      kind: "create",
      view: analyzingView,
      response: {
        worldPrId: record.view.worldPrId,
        status: "analyzing",
        reviewUrl: input.reviewUrl.replace("{worldPrId}", record.view.worldPrId),
        requestId: input.requestId,
        replayPending: true,
      },
      replay: false,
    };
    this.byIdempotency.set(idempotencyId, { bodyHash: input.bodyHash, status: "in_progress", result: pendingResult });
    this.byWorldPrId.set(record.view.worldPrId, analyzingView);
    this.byOwner.set(record.view.worldPrId, input.actorId);

    try {
      await this.waitForPlanningHook();
      if (this.nextPlanningFailure) {
        const failure = this.nextPlanningFailure;
        this.nextPlanningFailure = undefined;
        throw failure;
      }

      if (this.activeRule) {
        const view = buildFixtureClarificationView(record.view);
        const response = CreateWorldPrResponseSchema.parse({
          worldPrId: view.worldPrId,
          status: view.status,
          reviewUrl: input.reviewUrl.replace("{worldPrId}", view.worldPrId),
          clarification: view.clarification,
          requestId: input.requestId,
        });
        const result: CreateWorldPrStoreResult & { kind: "create" } = { kind: "create", view, response, replay: false };
        this.byWorldPrId.set(view.worldPrId, view);
        this.byIdempotency.set(idempotencyId, { bodyHash: input.bodyHash, status: "completed", result });
        return result;
      }

      this.reclaimOrRejectScenarioLock();
      const view = record.view;
      this.scenarioLock = { worldPrId: view.worldPrId, leaseUntil: Date.now() + 10 * 60_000, executionStarted: false };
      const response = CreateWorldPrResponseSchema.parse({
        worldPrId: view.worldPrId,
        status: view.status,
        reviewUrl: input.reviewUrl.replace("{worldPrId}", view.worldPrId),
        requestId: input.requestId,
      });
      const result: CreateWorldPrStoreResult & { kind: "create" } = { kind: "create", view, planPayload: record.planPayload, response, replay: false };
      this.byWorldPrId.set(view.worldPrId, view);
      this.byIdempotency.set(idempotencyId, { bodyHash: input.bodyHash, status: "completed", result });
      return result;
    } catch (error) {
      this.byWorldPrId.delete(record.view.worldPrId);
      this.byOwner.delete(record.view.worldPrId);
      if (this.scenarioLock?.worldPrId === record.view.worldPrId) this.scenarioLock = undefined;
      const failure = error instanceof StoreError
        ? error
        : error instanceof FakeProviderConfigurationError
          ? new StoreError("provider_unavailable", "Fixture providers are disabled outside test and development environments.")
          : new StoreError("internal_error", "The request could not be recorded safely; no external action was attempted.", { cause: error });
      this.byIdempotency.set(idempotencyId, { bodyHash: input.bodyHash, status: "failed", error: failure });
      throw failure;
    }
  }

  async get(worldPrId: string, actorId?: string): Promise<WorldPrView | null> {
    this.assertScope(worldPrId, actorId);
    return this.byWorldPrId.get(worldPrId) ?? null;
  }

  async cancel(input: CancelWorldPrStoreInput): Promise<CancelWorldPrStoreResult> {
    const parsed = CancelWorldPrRequestSchema.safeParse({});
    if (!parsed.success) throw new StoreError("internal_error", "Cancellation input could not be validated.");
    const key = idempotencyIdFor(input.actorId, input.endpoint, input.idempotencyKey);
    const existing = this.byIdempotency.get(key);
    if (existing) {
      if (existing.bodyHash !== input.bodyHash) throw new StoreError("idempotency_conflict", "This idempotency key was already used for a different request.");
      if (existing.status === "failed") throw new StoreError(existing.error.code, existing.error.message);
      if (existing.result.kind !== "cancel") throw new StoreError("idempotency_conflict", "This idempotency key belongs to a different operation.");
      return { ...existing.result, replay: true };
    }

    this.assertScope(input.worldPrId, input.actorId);
    const current = this.byWorldPrId.get(input.worldPrId);
    if (!current) throw new StoreError("task_not_found", "That World PR does not exist in the current controlled workspace.");
    if (current.status !== "preview_ready" && current.status !== "clarification_required") {
      throw new StoreError("invalid_task_state", "This World PR cannot be cancelled from its current state.");
    }
    const viewObject = structuredClone(current) as Record<string, unknown>;
    delete viewObject.runId;
    delete viewObject.activePlan;
    delete viewObject.clarification;
    delete viewObject.attention;
    viewObject.status = "cancelled";
    viewObject.updatedAt = new Date().toISOString();
    const view = WorldPrViewSchema.parse(viewObject);
    const response = TaskMutationResponseSchema.parse({ worldPrId: view.worldPrId, status: view.status, requestId: input.requestId });
    const result: CancelWorldPrStoreResult & { kind: "cancel" } = { kind: "cancel", view, response, replay: false };
    this.byWorldPrId.set(view.worldPrId, view);
    if (this.scenarioLock?.worldPrId === view.worldPrId) this.scenarioLock = undefined;
    this.byIdempotency.set(key, { bodyHash: input.bodyHash, status: "completed", result });
    return result;
  }

  clear(): void {
    this.byWorldPrId.clear();
    this.byOwner.clear();
    this.byIdempotency.clear();
    this.scenarioLock = undefined;
    this.activeRule = false;
    this.planningDelayMs = 0;
    this.nextPlanningFailure = undefined;
  }

  setFixtureRuleActive(active: boolean): void {
    this.activeRule = active;
  }

  setPlanningDelay(milliseconds: number): void {
    this.planningDelayMs = Math.max(0, milliseconds);
  }

  failNextPlanning(code: "internal_error" | "provider_unavailable" = "internal_error"): void {
    this.nextPlanningFailure = new StoreError(code, "The fixture planning attempt failed safely; no external action was attempted.");
  }

  expirePlanningLease(): void {
    if (this.scenarioLock) this.scenarioLock.leaseUntil = Date.now() - 1;
  }

  hasScenarioLock(): boolean {
    return this.scenarioLock !== undefined;
  }

  private async waitForPlanningHook(): Promise<void> {
    if (this.planningDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.planningDelayMs));
  }

  private reclaimOrRejectScenarioLock(): void {
    const lock = this.scenarioLock;
    if (!lock) return;
    if (lock.executionStarted || lock.leaseUntil > Date.now()) throw new StoreError("scenario_busy", "The controlled demo scenario is already in use.");
    this.scenarioLock = undefined;
    const expired = this.byWorldPrId.get(lock.worldPrId);
    if (expired && (expired.status === "analyzing" || expired.status === "preview_ready")) {
      this.byWorldPrId.set(lock.worldPrId, buildPlanningLeaseExpiredView(expired));
    }
  }

  private assertScope(worldPrId: string, actorId?: string): void {
    if (!actorId) return;
    const owner = this.byOwner.get(worldPrId);
    if (owner && !sharesWorldPrScope(owner, actorId)) throw new StoreError("forbidden", "This World PR is outside the authenticated workspace scope.");
  }
}

type RewindGlobal = typeof globalThis & { __rewindMemoryFixtureStore?: MemoryFixtureWorldPrStore };
const rewindGlobal = globalThis as RewindGlobal;
export const memoryFixtureStore = rewindGlobal.__rewindMemoryFixtureStore ??= new MemoryFixtureWorldPrStore();

function idempotencyIdFor(actorId: string, endpoint: string, key: string): string {
  return `${actorId}:${endpoint}:${key}`;
}
