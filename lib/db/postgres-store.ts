import { Pool, type PoolClient } from "pg";
import {
  CreateWorldPrResponseSchema,
  IdempotencyFailureSchema,
  TaskMutationResponseSchema,
  WorldPrViewSchema,
  isInitialPlanView,
  type CreateWorldPrResponse,
  type InitialPlanPayload,
  type TaskMutationResponse,
  type WorldPrView,
} from "@/lib/contracts/v1";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import {
  buildFixtureAnalyzingView,
  buildFixtureClarificationView,
  buildFixtureWorldPrRecord,
  buildPlanningLeaseExpiredView,
} from "@/lib/domain/fixture-world-pr";
import { canonicalJson } from "@/lib/domain/digest";
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

interface StoredWorldPrRecord {
  view: WorldPrView;
  planPayload: InitialPlanPayload;
}

interface IdempotencyRow {
  body_hash: string;
  response: unknown;
  resource_id: string | null;
  status: "in_progress" | "completed" | "failed";
}

export class PostgresWorldPrStore implements WorldPrStore {
  constructor(private readonly pool: Pool) {}

  async createInitial(input: CreateWorldPrStoreInput): Promise<CreateWorldPrStoreResult> {
    const record = buildFixtureWorldPrRecord(input.request);
    const analyzingView = buildFixtureAnalyzingView(record.view);
    const response = worldPrResponse(record.view, input);
    const claim = await this.pool.query(
      `INSERT INTO idempotency_records
        (actor_id, endpoint, key, body_hash, status, resource_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'in_progress', $5, now(), now())
       ON CONFLICT (actor_id, endpoint, key) DO NOTHING
       RETURNING key`,
      [input.actorId, input.endpoint, input.idempotencyKey, input.bodyHash, record.view.worldPrId],
    );
    if (!claim.rowCount) return this.replayExisting(input, record);

    let client: PoolClient | undefined;
    let transactionStarted = false;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;

      await client.query(
        `INSERT INTO tasks
          (id, run_id, request, status, planning_lease_until, read_model, created_at, updated_at)
         VALUES ($1, NULL, $2, 'analyzing', now() + interval '10 minutes', $3::jsonb, now(), now())`,
        [record.view.worldPrId, record.view.request, JSON.stringify(analyzingView)],
      );

      const activeRule = await client.query<{ id: string }>(
        `SELECT id FROM prevention_rules
         WHERE status = 'active'
           AND condition @> '{"type":"calendar_company_region_ambiguity","company":"Acme"}'::jsonb
         LIMIT 1`,
      );
      if (activeRule.rows.length > 0) {
        const clarificationView = buildFixtureClarificationView(record.view);
        await client.query(
          `UPDATE tasks
           SET status = 'clarification_required', run_id = NULL, planning_lease_until = NULL, read_model = $2::jsonb, updated_at = now()
           WHERE id = $1`,
          [record.view.worldPrId, JSON.stringify(clarificationView)],
        );
        await this.insertAudit(client, record.view.worldPrId, "world_pr.clarification_required", input.actorId);
        const clarificationResponse = CreateWorldPrResponseSchema.parse({
          worldPrId: clarificationView.worldPrId,
          status: "clarification_required",
          reviewUrl: input.reviewUrl.replace("{worldPrId}", clarificationView.worldPrId),
          clarification: clarificationView.clarification,
          requestId: input.requestId,
        });
        await this.completeIdempotency(client, input, clarificationResponse);
        await client.query("COMMIT");
        transactionStarted = false;
        return { kind: "create", view: clarificationView, response: clarificationResponse, replay: false };
      }

      await this.expireReclaimablePlanningLeases(client, input.actorId);
      const scenarioLock = await client.query(
        `INSERT INTO scenario_locks (scenario_key, task_id, acquired_at, lease_until)
         VALUES ('acme-demo', $1, now(), now() + interval '10 minutes')
         ON CONFLICT (scenario_key) DO NOTHING
         RETURNING scenario_key`,
        [record.view.worldPrId],
      );
      if (!scenarioLock.rowCount) throw new StoreError("scenario_busy", "The controlled demo scenario is already in use.");

      const finalView = record.view;
      await client.query(
        `UPDATE tasks
         SET run_id = $2, status = 'preview_ready', planning_lease_until = now() + interval '10 minutes', read_model = $3::jsonb, updated_at = now()
         WHERE id = $1`,
        [finalView.worldPrId, finalView.runId, JSON.stringify(finalView)],
      );
      await client.query(
        `INSERT INTO plans
          (id, task_id, kind, version, schema_version, prompt_version, model, payload, digest, created_at)
         VALUES ($1, $2, 'initial', 1, 'initial-plan.v1', 'fixture-initial.v1', 'fixture-initial.v1', $3::jsonb, $4, now())`,
        [record.planPayload.planId, finalView.worldPrId, JSON.stringify(record.planPayload), record.planPayload.digest],
      );
      await this.insertAudit(client, finalView.worldPrId, "world_pr.created", input.actorId);
      await this.completeIdempotency(client, input, response);
      await client.query("COMMIT");
      transactionStarted = false;
      return { kind: "create", view: finalView, planPayload: record.planPayload, response, replay: false };
    } catch (error) {
      if (client && transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      const failure = toStoreError(error);
      try {
        await this.markIdempotencyFailed(input, failure);
      } catch (reconcileError) {
        throw new StoreError("internal_error", "The idempotency claim could not be reconciled after planning failed.", { cause: reconcileError });
      }
      throw failure;
    } finally {
      client?.release();
    }
  }

  async get(worldPrId: string, actorId?: string): Promise<WorldPrView | null> {
    const taskView = await this.readTaskView(worldPrId);
    if (!taskView) return null;
    if (actorId) await this.assertOwner(worldPrId, actorId);
    if (!taskView.activePlan) return taskView;
    if (!isInitialPlanView(taskView.activePlan)) throw new StoreError("internal_error", "The stored plan kind is not supported by the current repository slice.");
    const record = await this.readRecord(worldPrId, taskView.activePlan.pointer.version);
    if (!record) throw new StoreError("internal_error", "An active World PR is missing its immutable plan payload.");
    return record.view;
  }

  async cancel(input: CancelWorldPrStoreInput): Promise<CancelWorldPrStoreResult> {
    const claim = await this.pool.query(
      `INSERT INTO idempotency_records
        (actor_id, endpoint, key, body_hash, status, resource_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'in_progress', $5, now(), now())
       ON CONFLICT (actor_id, endpoint, key) DO NOTHING
       RETURNING key`,
      [input.actorId, input.endpoint, input.idempotencyKey, input.bodyHash, input.worldPrId],
    );
    if (!claim.rowCount) return this.replayCancel(input);

    let client: PoolClient | undefined;
    let transactionStarted = false;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      await this.assertOwnerWithClient(client, input.worldPrId, input.actorId);
      const taskResult = await client.query<{ read_model: unknown }>("SELECT read_model FROM tasks WHERE id = $1 FOR UPDATE", [input.worldPrId]);
      if (!taskResult.rowCount) throw new StoreError("task_not_found", "That World PR does not exist in the current controlled workspace.");
      const current = WorldPrViewSchema.parse(taskResult.rows[0].read_model);
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
      await client.query(
        `UPDATE tasks SET status = 'cancelled', run_id = NULL, planning_lease_until = NULL, read_model = $2::jsonb, updated_at = now() WHERE id = $1`,
        [input.worldPrId, JSON.stringify(view)],
      );
      await client.query("DELETE FROM scenario_locks WHERE scenario_key = 'acme-demo' AND task_id = $1", [input.worldPrId]);
      await this.insertAudit(client, input.worldPrId, "world_pr.cancelled", input.actorId);
      const response = TaskMutationResponseSchema.parse({ worldPrId: view.worldPrId, status: view.status, requestId: input.requestId });
      await this.completeIdempotency(client, input, response);
      await client.query("COMMIT");
      transactionStarted = false;
      return { kind: "cancel", view, response, replay: false };
    } catch (error) {
      if (client && transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      const failure = toStoreError(error);
      try {
        await this.markIdempotencyFailed(input, failure);
      } catch (reconcileError) {
        throw new StoreError("internal_error", "The cancellation claim could not be reconciled safely.", { cause: reconcileError });
      }
      throw failure;
    } finally {
      client?.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async replayExisting(input: CreateWorldPrStoreInput, fixtureRecord: ReturnType<typeof buildFixtureWorldPrRecord>): Promise<CreateWorldPrStoreResult> {
    const existing = await this.readIdempotency(input.actorId, input.endpoint, input.idempotencyKey);
    if (!existing || existing.body_hash !== input.bodyHash) throw new StoreError("idempotency_conflict", "This idempotency key was already used for a different request.");
    if (existing.status === "failed") throw readFailedError(existing.response);
    if (existing.status === "in_progress") {
      const current = existing.resource_id ? await this.readTaskView(existing.resource_id).catch(() => null) : null;
      const view = current ?? WorldPrViewSchema.parse({
        ...buildFixtureAnalyzingView(fixtureRecord.view),
        ...(existing.resource_id ? { worldPrId: existing.resource_id } : {}),
      });
      const response = CreateWorldPrResponseSchema.parse({
        worldPrId: view.worldPrId,
        status: "analyzing",
        reviewUrl: input.reviewUrl.replace("{worldPrId}", view.worldPrId),
        requestId: input.requestId,
        replayPending: true,
      });
      return { kind: "create", view, response, replay: true };
    }
    if (!existing.resource_id || !existing.response) throw new StoreError("internal_error", "The idempotency record has no durable resource response.");
    const view = await this.readTaskView(existing.resource_id);
    if (!view) throw new StoreError("task_not_found", "That World PR does not exist in the current controlled workspace.");
    const storedResponse = CreateWorldPrResponseSchema.parse(existing.response);
    if (!view.activePlan || !isInitialPlanView(view.activePlan)) {
      return { kind: "create", view, response: storedResponse, replay: true };
    }
    const record = await this.readRecord(existing.resource_id, view.activePlan.pointer.version);
    if (record) return { kind: "create", ...record, response: storedResponse, replay: true };
    return { kind: "create", view, response: storedResponse, replay: true };
  }

  private async replayCancel(input: CancelWorldPrStoreInput): Promise<CancelWorldPrStoreResult> {
    const existing = await this.readIdempotency(input.actorId, input.endpoint, input.idempotencyKey);
    if (!existing || existing.body_hash !== input.bodyHash) throw new StoreError("idempotency_conflict", "This idempotency key was already used for a different request.");
    if (existing.status === "failed") throw readFailedError(existing.response);
    const view = await this.get(input.worldPrId, input.actorId);
    if (!view) throw new StoreError("task_not_found", "That World PR does not exist in the current controlled workspace.");
    if (existing.status === "in_progress") {
      return {
        kind: "cancel",
        view,
        response: mutationResponseForView(view, input.requestId, true),
        replay: true,
      };
    }
    if (!existing.response) throw new StoreError("internal_error", "The cancellation idempotency record has no durable response.");
    const response = TaskMutationResponseSchema.parse(existing.response);
    return { kind: "cancel", view, response, replay: true };
  }

  private async readIdempotency(actorId: string, endpoint: string, key: string): Promise<IdempotencyRow | null> {
    const result = await this.pool.query<IdempotencyRow>(
      `SELECT body_hash, response, resource_id, status
       FROM idempotency_records
       WHERE actor_id = $1 AND endpoint = $2 AND key = $3`,
      [actorId, endpoint, key],
    );
    return result.rows[0] ?? null;
  }

  private async readTaskView(worldPrId: string): Promise<WorldPrView | null> {
    const result = await this.pool.query<{ read_model: unknown }>("SELECT read_model FROM tasks WHERE id = $1", [worldPrId]);
    if (!result.rowCount) return null;
    return WorldPrViewSchema.parse(result.rows[0].read_model);
  }

  private async readRecord(worldPrId: string, version: number): Promise<StoredWorldPrRecord | null> {
    const result = await this.pool.query<{ read_model: unknown; payload: unknown }>(
      `SELECT tasks.read_model, plans.payload
       FROM tasks
       JOIN plans ON plans.task_id = tasks.id AND plans.kind = 'initial' AND plans.version = $2
       WHERE tasks.id = $1`,
      [worldPrId, version],
    );
    if (!result.rowCount) return null;
    const record = {
      view: WorldPrViewSchema.parse(result.rows[0].read_model),
      planPayload: VerifiedInitialPlanPayloadSchema.parse(result.rows[0].payload),
    };
    assertStoredRecordConsistency(record);
    return record;
  }

  private async assertOwner(worldPrId: string, actorId: string): Promise<void> {
    const result = await this.pool.query<{ actor_id: string }>(
      `SELECT actor_id
       FROM idempotency_records
       WHERE resource_id = $1 AND endpoint = 'POST /api/v1/world-prs'
       LIMIT 1`,
      [worldPrId],
    );
    if (!result.rows[0] || !sharesWorldPrScope(result.rows[0].actor_id, actorId)) {
      throw new StoreError("forbidden", "This World PR is outside the authenticated workspace scope.");
    }
  }

  private async assertOwnerWithClient(client: PoolClient, worldPrId: string, actorId: string): Promise<void> {
    const result = await client.query<{ actor_id: string }>(
      `SELECT actor_id
       FROM idempotency_records
       WHERE resource_id = $1 AND endpoint = 'POST /api/v1/world-prs'
       LIMIT 1`,
      [worldPrId],
    );
    if (!result.rows[0] || !sharesWorldPrScope(result.rows[0].actor_id, actorId)) {
      throw new StoreError("forbidden", "This World PR is outside the authenticated workspace scope.");
    }
  }

  private async expireReclaimablePlanningLeases(client: PoolClient, actorId: string): Promise<void> {
    const expired = await client.query<{ task_id: string }>(
      `DELETE FROM scenario_locks AS locks
       WHERE locks.scenario_key = 'acme-demo'
         AND locks.lease_until IS NOT NULL
         AND locks.lease_until <= now()
         AND locks.execution_started_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM approvals
           JOIN plans ON plans.id = approvals.plan_id
           WHERE plans.task_id = locks.task_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM action_executions
           JOIN plans ON plans.id = action_executions.plan_id
           WHERE plans.task_id = locks.task_id
         )
       RETURNING locks.task_id`,
    );
    for (const lock of expired.rows) {
      const task = await client.query<{ read_model: unknown }>("SELECT read_model FROM tasks WHERE id = $1 FOR UPDATE", [lock.task_id]);
      if (!task.rowCount) throw new StoreError("internal_error", "An expired scenario lock has no task record.");
      const current = WorldPrViewSchema.parse(task.rows[0].read_model);
      if (current.status !== "analyzing" && current.status !== "preview_ready") {
        throw new StoreError("internal_error", "An expired scenario lock is not attached to a reclaimable planning state.");
      }
      const failed = buildPlanningLeaseExpiredView(current);
      await client.query(
        `UPDATE tasks
         SET status = 'failed', run_id = NULL, planning_lease_until = NULL, read_model = $2::jsonb, updated_at = now()
         WHERE id = $1`,
        [lock.task_id, JSON.stringify(failed)],
      );
      await this.insertAudit(client, lock.task_id, "planning.lease_expired", actorId);
    }
  }

  private async insertAudit(client: PoolClient, taskId: string, eventType: string, actorId: string): Promise<void> {
    await client.query(
      "INSERT INTO audit_events (task_id, event_type, metadata, occurred_at) VALUES ($1, $2, $3::jsonb, now())",
      [taskId, eventType, JSON.stringify({ actorId, source: actorId.startsWith("mcp:") ? "mcp" : "dashboard" })],
    );
  }

  private async completeIdempotency(client: PoolClient, input: CreateWorldPrStoreInput | CancelWorldPrStoreInput, response: CreateWorldPrResponse | TaskMutationResponse): Promise<void> {
    await client.query(
      `UPDATE idempotency_records
       SET status = 'completed', response = $4::jsonb, updated_at = now()
       WHERE actor_id = $1 AND endpoint = $2 AND key = $3`,
      [input.actorId, input.endpoint, input.idempotencyKey, JSON.stringify(response)],
    );
  }

  private async markIdempotencyFailed(input: CreateWorldPrStoreInput | CancelWorldPrStoreInput, error: StoreError): Promise<void> {
    const response = {
      code: error.code,
      message: safeStoreMessage(error.code),
      retryable: false,
      requestId: input.requestId,
    };
    await this.pool.query(
      `UPDATE idempotency_records
       SET status = 'failed', response = $4::jsonb, updated_at = now()
       WHERE actor_id = $1 AND endpoint = $2 AND key = $3`,
      [input.actorId, input.endpoint, input.idempotencyKey, JSON.stringify(response)],
    );
  }
}

function assertStoredRecordConsistency(record: StoredWorldPrRecord): void {
  const activePlan = record.view.activePlan;
  const payload = record.planPayload;
  if (!activePlan || !isInitialPlanView(activePlan)) throw new StoreError("internal_error", "Stored World PR read model does not match its immutable plan payload.");
  const selected = payload.candidateSet.find((candidate) => candidate.candidateId === payload.selectedCandidateId);
  const alternativeId = payload.alternativeCandidateIds[0];
  const alternative = payload.candidateSet.find((candidate) => candidate.candidateId === alternativeId);
  if (
    record.view.worldPrId !== payload.taskId ||
    record.view.request !== payload.request ||
    activePlan.pointer.planId !== payload.planId ||
    activePlan.pointer.version !== payload.version ||
    activePlan.pointer.digest !== payload.digest ||
    !selected ||
    !alternative ||
    activePlan.selectedCandidate.candidateId !== selected.candidateId ||
    activePlan.selectedCandidate.label !== selected.title ||
    activePlan.alternatives[0].candidateId !== alternativeId ||
    activePlan.alternatives[0].label !== alternative.title ||
    record.view.runId !== payload.actions[2].desired.runId ||
    canonicalJson(activePlan.assumptions) !== canonicalJson(payload.assumptions) ||
    canonicalJson(activePlan.actions) !== canonicalJson(payload.actions)
  ) {
    throw new StoreError("internal_error", "Stored World PR read model does not match its immutable plan payload.");
  }
}

function worldPrResponse(view: WorldPrView, input: CreateWorldPrStoreInput): CreateWorldPrResponse {
  return CreateWorldPrResponseSchema.parse({
    worldPrId: view.worldPrId,
    status: "preview_ready",
    reviewUrl: input.reviewUrl.replace("{worldPrId}", view.worldPrId),
    requestId: input.requestId,
  });
}

function mutationResponseForView(view: WorldPrView, requestId: string, replayPending = false): TaskMutationResponse {
  return TaskMutationResponseSchema.parse({
    worldPrId: view.worldPrId,
    status: view.status,
    ...(view.activePlan ? { activePlan: view.activePlan.pointer } : {}),
    ...(view.attention ? { attention: view.attention } : {}),
    ...(replayPending ? { replayPending: true as const } : {}),
    requestId,
  });
}

function toStoreError(error: unknown): StoreError {
  if (error instanceof StoreError) return error;
  if (error instanceof FakeProviderConfigurationError) return new StoreError("provider_unavailable", "Fixture providers are disabled outside test and development environments.", { cause: error });
  return new StoreError("internal_error", "The request could not be recorded safely; no external action was attempted.", { cause: error });
}

function readFailedError(response: unknown): StoreError {
  const parsed = IdempotencyFailureSchema.safeParse(response);
  if (!parsed.success) return new StoreError("internal_error", "The failed idempotency result is not a valid safe error.");
  return new StoreError(parsed.data.code as StoreError["code"], parsed.data.message);
}

function safeStoreMessage(code: StoreError["code"]): string {
  switch (code) {
    case "scenario_busy": return "The controlled demo scenario is already in use.";
    case "idempotency_conflict": return "This idempotency key was already used for a different request.";
    case "forbidden": return "This World PR is outside the authenticated workspace scope.";
    case "task_not_found": return "That World PR does not exist in the current controlled workspace.";
    case "invalid_task_state": return "This World PR cannot be changed from its current state.";
    case "provider_unavailable": return "The configured storage or provider boundary is unavailable; no external action was attempted.";
    default: return "The request could not be recorded safely; no external action was attempted.";
  }
}
