import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";
import {
  CreateWorldPrResponseSchema,
  isInitialPlanView,
  WorldPrViewSchema,
  type CreateWorldPrResponse,
  type InitialPlanPayload,
  type WorldPrView,
} from "@/lib/contracts/v1";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { buildFixtureWorldPrRecord } from "@/lib/domain/fixture-world-pr";
import { canonicalJson } from "@/lib/domain/digest";
import type { CreateWorldPrStoreInput, CreateWorldPrStoreResult, WorldPrStore } from "@/lib/db/store";

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
    const response = worldPrResponse(record.view, input);
    const claim = await this.pool.query(
      `INSERT INTO idempotency_records
        (actor_id, endpoint, key, body_hash, status, resource_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'in_progress', $5, now(), now())
       ON CONFLICT (actor_id, endpoint, key) DO NOTHING
       RETURNING key`,
      [input.actorId, input.endpoint, input.idempotencyKey, input.bodyHash, record.view.worldPrId],
    );
    if (!claim.rowCount) return this.replayExisting(input);

    let client: PoolClient | undefined;
    let transactionStarted = false;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(
        `INSERT INTO tasks
          (id, run_id, request, status, read_model, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())`,
        [record.view.worldPrId, record.view.runId, record.view.request, record.view.status, JSON.stringify(record.view)],
      );
      const scenarioLock = await client.query(
        `INSERT INTO scenario_locks (scenario_key, task_id, acquired_at, lease_until)
         VALUES ('acme-demo', $1, now(), now() + interval '10 minutes')
         ON CONFLICT (scenario_key) DO NOTHING
         RETURNING scenario_key`,
        [record.view.worldPrId],
      );
      if (!scenarioLock.rowCount) throw new Error("scenario_busy");
      await client.query(
        `INSERT INTO plans
          (id, task_id, kind, version, schema_version, prompt_version, model, payload, digest, created_at)
         VALUES ($1, $2, 'initial', 1, 'initial-plan.v1', 'fixture-initial.v1', 'fixture-initial.v1', $3::jsonb, $4, now())`,
        [
          record.planPayload.planId,
          record.view.worldPrId,
          JSON.stringify(record.planPayload),
          record.planPayload.digest,
        ],
      );
      await client.query(
        "INSERT INTO audit_events (task_id, event_type, metadata, occurred_at) VALUES ($1, 'world_pr.created', $2::jsonb, now())",
        [
          record.view.worldPrId,
          JSON.stringify({ source: input.actorId.startsWith("mcp:") ? "mcp" : "dashboard" }),
        ],
      );
      await client.query(
        `UPDATE idempotency_records
         SET status = 'completed', response = $4::jsonb, updated_at = now()
         WHERE actor_id = $1 AND endpoint = $2 AND key = $3`,
        [input.actorId, input.endpoint, input.idempotencyKey, JSON.stringify(response)],
      );
      await client.query("COMMIT");
      transactionStarted = false;
      return { ...record, response, replay: false };
    } catch (error) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      const errorCode = knownFailureCode(error);
      try {
        await this.pool.query(
          `UPDATE idempotency_records
           SET status = 'failed', response = $4::jsonb, updated_at = now()
           WHERE actor_id = $1 AND endpoint = $2 AND key = $3`,
          [input.actorId, input.endpoint, input.idempotencyKey, JSON.stringify({ errorCode })],
        );
      } catch {
        throw new Error("The idempotency claim could not be reconciled after planning failed.", { cause: error });
      }
      throw error;
    } finally {
      client?.release();
    }
  }

  async get(worldPrId: string): Promise<WorldPrView | null> {
    const result = await this.pool.query<{ read_model: unknown }>("SELECT read_model FROM tasks WHERE id = $1", [worldPrId]);
    if (!result.rowCount) return null;
    const view = WorldPrViewSchema.parse(result.rows[0].read_model);
    if (!view.activePlan) return view;

    const record = await this.readRecord(worldPrId);
    if (!record) throw new Error("An active World PR is missing its immutable plan payload.");
    return record.view;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async replayExisting(input: CreateWorldPrStoreInput): Promise<CreateWorldPrStoreResult> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const existing = await this.pool.query<IdempotencyRow>(
        `SELECT body_hash, response, resource_id, status
         FROM idempotency_records
         WHERE actor_id = $1 AND endpoint = $2 AND key = $3`,
        [input.actorId, input.endpoint, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row || row.body_hash !== input.bodyHash) throw new Error("idempotency_conflict");
      if (row.status === "failed") throw new Error(readFailedCode(row.response));
      if (row.status === "completed") {
        if (!row.resource_id || !row.response) throw new Error("internal_error");
        const stored = await this.readRecord(row.resource_id);
        if (!stored) throw new Error("task_not_found");
        const storedResponse = CreateWorldPrResponseSchema.parse(row.response);
        return { ...stored, response: storedResponse, replay: true };
      }
      await delay(25);
    }
    throw new Error("internal_error");
  }

  private async readRecord(worldPrId: string): Promise<StoredWorldPrRecord | null> {
    const result = await this.pool.query<{ read_model: unknown; payload: unknown }>(
      `SELECT tasks.read_model, plans.payload
       FROM tasks
       JOIN plans ON plans.task_id = tasks.id AND plans.kind = 'initial' AND plans.version = 1
       WHERE tasks.id = $1`,
      [worldPrId],
    );
    if (!result.rowCount) return null;
    const record = {
      view: WorldPrViewSchema.parse(result.rows[0].read_model),
      planPayload: VerifiedInitialPlanPayloadSchema.parse(result.rows[0].payload),
    };
    assertStoredRecordConsistency(record);
    return record;
  }
}

function assertStoredRecordConsistency(record: StoredWorldPrRecord): void {
  const activePlan = record.view.activePlan;
  const payload = record.planPayload;
  if (!activePlan || !isInitialPlanView(activePlan)) {
    throw new Error("Stored World PR read model does not match its immutable plan payload.");
  }
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
    throw new Error("Stored World PR read model does not match its immutable plan payload.");
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

function knownFailureCode(error: unknown): "scenario_busy" | "internal_error" {
  return error instanceof Error && error.message === "scenario_busy" ? "scenario_busy" : "internal_error";
}

function readFailedCode(response: unknown): "scenario_busy" | "internal_error" {
  if (typeof response === "object" && response !== null && "errorCode" in response && response.errorCode === "scenario_busy") {
    return "scenario_busy";
  }
  return "internal_error";
}
