import type { Pool, QueryResultRow } from "pg";
import {
  ActionExecutionRecordSchema,
  ApprovalRecordSchema,
  ExecutionPlanSchema,
  RedactedActionErrorSchema,
  type ActionExecutionRecord,
  type ApprovalRecord,
  type ExecutionPlan,
  type ExecutionReceipt,
  stableOperationKey,
} from "@/lib/contracts/execution-persistence";
import { createOpaqueId } from "@/lib/domain/ids";

export type ExecutionPersistenceErrorCode =
  | "plan_immutable_conflict"
  | "plan_not_found"
  | "approval_conflict"
  | "action_immutable_conflict"
  | "action_not_found"
  | "action_not_claimable"
  | "lease_reconciliation_required"
  | "persistence_failure";

export class ExecutionPersistenceError extends Error {
  constructor(public readonly code: ExecutionPersistenceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExecutionPersistenceError";
  }
}

export type PlannedActionInput = Readonly<{
  actionExecutionId?: string;
  planId: string;
  actionKey: string;
  type: ActionExecutionRecord["type"];
  targetRef: string;
  operationKey?: string;
  action: Record<string, unknown>;
}>;

export type CreateApprovalInput = ApprovalRecord;

export type ClaimActionInput = Readonly<{
  actionExecutionId: string;
  now: string;
  leaseUntil: string;
  dispatchStartedAt?: string;
}>;

export type RecordActionStateInput = Readonly<{
  actionExecutionId: string;
  status: ActionExecutionRecord["status"];
  now: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  receipt?: ExecutionReceipt;
  error?: { code: string; retryable: boolean; safeMessage: string };
  dispatchStartedAt?: string;
}>;

export interface ExecutionPersistenceStore {
  createPlan(plan: ExecutionPlan): Promise<ExecutionPlan>;
  getPlan(planId: string): Promise<ExecutionPlan | null>;
  createApproval(input: CreateApprovalInput): Promise<{ approval: ApprovalRecord; replay: boolean }>;
  getApproval(planId: string): Promise<ApprovalRecord | null>;
  ensureActionRows(actions: readonly PlannedActionInput[]): Promise<readonly ActionExecutionRecord[]>;
  getAction(actionExecutionId: string): Promise<ActionExecutionRecord | null>;
  listActions(planId: string): Promise<readonly ActionExecutionRecord[]>;
  claimAction(input: ClaimActionInput): Promise<{ claimed: boolean; record: ActionExecutionRecord }>;
  recordActionState(input: RecordActionStateInput): Promise<ActionExecutionRecord>;
  reconcileExpiredLease(actionExecutionId: string, now: string): Promise<ActionExecutionRecord>;
}

function clonePlan(plan: ExecutionPlan): ExecutionPlan {
  return ExecutionPlanSchema.parse(JSON.parse(JSON.stringify(plan)) as unknown);
}

function cloneApproval(approval: ApprovalRecord): ApprovalRecord {
  return ApprovalRecordSchema.parse(JSON.parse(JSON.stringify(approval)) as unknown);
}

function cloneAction(action: ActionExecutionRecord): ActionExecutionRecord {
  return ActionExecutionRecordSchema.parse(JSON.parse(JSON.stringify(action)) as unknown);
}

function isTerminal(status: ActionExecutionRecord["status"]): boolean {
  return status === "succeeded" || status === "delivery_uncertain" || status === "conflict" || status === "permanently_failed";
}

function actionRecord(input: PlannedActionInput): ActionExecutionRecord {
  const actionExecutionId = input.actionExecutionId ?? createOpaqueId("act_");
  const parsed = ActionExecutionRecordSchema.parse({
    actionExecutionId,
    planId: input.planId,
    actionKey: input.actionKey,
    type: input.type,
    targetRef: input.targetRef,
    operationKey: input.operationKey ?? stableOperationKey(input.planId, input.actionKey),
    status: "planned",
    action: input.action,
    attempts: 0,
    leaseUntil: null,
    dispatchStartedAt: null,
    startedAt: null,
    finishedAt: null,
  });
  return parsed;
}

function assertSameAction(left: ActionExecutionRecord, right: ActionExecutionRecord): void {
  if (
    left.planId !== right.planId ||
    left.actionKey !== right.actionKey ||
    left.type !== right.type ||
    left.targetRef !== right.targetRef ||
    left.operationKey !== right.operationKey ||
    JSON.stringify(left.action) !== JSON.stringify(right.action)
  ) {
    throw new ExecutionPersistenceError("action_immutable_conflict", "The action key is already bound to a different immutable action.");
  }
}

function errorFor(code: string, retryable: boolean, safeMessage: string) {
  return RedactedActionErrorSchema.parse({ code, retryable, safeMessage });
}

/** In-memory deterministic ledger used by unit tests and fixture E2E only. */
export class MemoryExecutionPersistenceStore implements ExecutionPersistenceStore {
  private readonly plans = new Map<string, ExecutionPlan>();
  private readonly planVersions = new Map<string, string>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly actions = new Map<string, ActionExecutionRecord>();
  private readonly actionKeys = new Map<string, string>();

  async createPlan(plan: ExecutionPlan): Promise<ExecutionPlan> {
    const parsed = ExecutionPlanSchema.parse(plan);
    const versionKey = `${parsed.taskId}:${parsed.kind}:${parsed.version}`;
    const existingByVersion = this.planVersions.get(versionKey);
    if (existingByVersion && existingByVersion !== parsed.planId) {
      const existing = this.plans.get(existingByVersion);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(parsed)) {
        throw new ExecutionPersistenceError("plan_immutable_conflict", "A plan version is already bound to different immutable content.");
      }
      return clonePlan(existing);
    }
    const existing = this.plans.get(parsed.planId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(parsed)) throw new ExecutionPersistenceError("plan_immutable_conflict", "An immutable plan cannot be changed.");
      return clonePlan(existing);
    }
    this.plans.set(parsed.planId, clonePlan(parsed));
    this.planVersions.set(versionKey, parsed.planId);
    return clonePlan(parsed);
  }

  async getPlan(planId: string): Promise<ExecutionPlan | null> {
    const plan = this.plans.get(planId);
    return plan ? clonePlan(plan) : null;
  }

  async createApproval(input: CreateApprovalInput): Promise<{ approval: ApprovalRecord; replay: boolean }> {
    const approval = ApprovalRecordSchema.parse(input);
    if (!this.plans.has(approval.planId)) throw new ExecutionPersistenceError("plan_not_found", "The approved plan does not exist.");
    const existing = this.approvals.get(approval.planId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(approval)) throw new ExecutionPersistenceError("approval_conflict", "This plan already has a different immutable approval.");
      return { approval: cloneApproval(existing), replay: true };
    }
    this.approvals.set(approval.planId, cloneApproval(approval));
    return { approval: cloneApproval(approval), replay: false };
  }

  async getApproval(planId: string): Promise<ApprovalRecord | null> {
    const approval = this.approvals.get(planId);
    return approval ? cloneApproval(approval) : null;
  }

  async ensureActionRows(inputs: readonly PlannedActionInput[]): Promise<readonly ActionExecutionRecord[]> {
    const result: ActionExecutionRecord[] = [];
    for (const input of inputs) {
      const candidate = actionRecord(input);
      const key = `${candidate.planId}:${candidate.actionKey}`;
      const existingId = this.actionKeys.get(key);
      if (existingId) {
        const existing = this.actions.get(existingId);
        if (!existing) throw new ExecutionPersistenceError("persistence_failure", "The action uniqueness index is inconsistent.");
        assertSameAction(existing, candidate);
        result.push(cloneAction(existing));
        continue;
      }
      this.actions.set(candidate.actionExecutionId, candidate);
      this.actionKeys.set(key, candidate.actionExecutionId);
      result.push(cloneAction(candidate));
    }
    return result;
  }

  async getAction(actionExecutionId: string): Promise<ActionExecutionRecord | null> {
    const action = this.actions.get(actionExecutionId);
    return action ? cloneAction(action) : null;
  }

  async listActions(planId: string): Promise<readonly ActionExecutionRecord[]> {
    return Array.from(this.actions.values()).filter((action) => action.planId === planId).sort((left, right) => left.actionKey.localeCompare(right.actionKey)).map(cloneAction);
  }

  async claimAction(input: ClaimActionInput): Promise<{ claimed: boolean; record: ActionExecutionRecord }> {
    const current = this.actions.get(input.actionExecutionId);
    if (!current) throw new ExecutionPersistenceError("action_not_found", "The action ledger row does not exist.");
    if (isTerminal(current.status)) return { claimed: false, record: cloneAction(current) };
    if (current.status === "in_progress" && current.leaseUntil && Date.parse(current.leaseUntil) > Date.parse(input.now)) {
      return { claimed: false, record: cloneAction(current) };
    }
    if (current.status !== "planned" && current.status !== "retryable_failed" && current.status !== "in_progress") {
      throw new ExecutionPersistenceError("action_not_claimable", "The action is not in a known-safe state for execution.");
    }
    const claimed = ActionExecutionRecordSchema.parse({
      ...current,
      status: "in_progress",
      attempts: current.attempts + 1,
      leaseUntil: input.leaseUntil,
      dispatchStartedAt: input.dispatchStartedAt ?? current.dispatchStartedAt,
      startedAt: current.startedAt ?? input.now,
      finishedAt: null,
      receipt: undefined,
      error: undefined,
    });
    this.actions.set(claimed.actionExecutionId, claimed);
    return { claimed: true, record: cloneAction(claimed) };
  }

  async recordActionState(input: RecordActionStateInput): Promise<ActionExecutionRecord> {
    const current = this.actions.get(input.actionExecutionId);
    if (!current) throw new ExecutionPersistenceError("action_not_found", "The action ledger row does not exist.");
    if (isTerminal(current.status) && input.status !== current.status) return cloneAction(current);
    const next = ActionExecutionRecordSchema.parse({
      ...current,
      status: input.status,
      beforeState: input.beforeState ?? current.beforeState,
      afterState: input.afterState ?? current.afterState,
      receipt: input.receipt,
      error: input.error ? errorFor(input.error.code, input.error.retryable, input.error.safeMessage) : undefined,
      dispatchStartedAt: input.dispatchStartedAt ?? current.dispatchStartedAt,
      leaseUntil: input.status === "in_progress" ? current.leaseUntil : null,
      finishedAt: input.status === "in_progress" ? null : input.now,
    });
    this.actions.set(next.actionExecutionId, next);
    return cloneAction(next);
  }

  async reconcileExpiredLease(actionExecutionId: string, now: string): Promise<ActionExecutionRecord> {
    const current = this.actions.get(actionExecutionId);
    if (!current) throw new ExecutionPersistenceError("action_not_found", "The action ledger row does not exist.");
    if (current.status !== "in_progress" || !current.leaseUntil || Date.parse(current.leaseUntil) > Date.parse(now)) return cloneAction(current);
    if (current.type === "mail.notify" || current.type === "mail.correct") {
      return this.recordActionState({
        actionExecutionId,
        status: "delivery_uncertain",
        now,
        receipt: { status: "delivery_uncertain", reason: "process_interrupted" },
        error: { code: "delivery_uncertain", retryable: false, safeMessage: "Gmail handoff could not be reconciled after the execution lease expired." },
      });
    }
    throw new ExecutionPersistenceError("lease_reconciliation_required", "An expired non-mail action requires provider-state reconciliation before retry.");
  }

  clear(): void {
    this.plans.clear();
    this.planVersions.clear();
    this.approvals.clear();
    this.actions.clear();
    this.actionKeys.clear();
  }
}

type PlanRow = QueryResultRow & {
  id: string;
  task_id: string;
  kind: string;
  version: number;
  schema_version: string;
  prompt_version: string | null;
  model: string | null;
  payload: unknown;
  digest: string;
  created_at: Date | string;
};

type ApprovalRow = QueryResultRow & {
  id: string;
  plan_id: string;
  plan_digest: string;
  actor_id: string;
  approved_at: Date | string;
};

type ActionRow = QueryResultRow & {
  id: string;
  plan_id: string;
  action_key: string;
  type: string;
  target_ref: string;
  status: string;
  action: unknown;
  before_state: unknown;
  after_state: unknown;
  receipt: unknown;
  attempts: number;
  lease_until: Date | string | null;
  dispatch_started_at: Date | string | null;
  error: unknown;
  started_at: Date | string | null;
  finished_at: Date | string | null;
};

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function rowToPlan(row: PlanRow): ExecutionPlan {
  return ExecutionPlanSchema.parse({
    planId: row.id,
    taskId: row.task_id,
    kind: row.kind,
    version: row.version,
    schemaVersion: row.schema_version,
    promptVersion: row.prompt_version,
    model: row.model,
    payload: row.payload,
    digest: row.digest,
    createdAt: iso(row.created_at),
  });
}

function rowToApproval(row: ApprovalRow): ApprovalRecord {
  return ApprovalRecordSchema.parse({
    approvalId: row.id,
    planId: row.plan_id,
    planVersion: 1,
    planDigest: row.plan_digest,
    actorId: row.actor_id,
    approvedAt: iso(row.approved_at),
  });
}

function rowToAction(row: ActionRow): ActionExecutionRecord {
  return ActionExecutionRecordSchema.parse({
    actionExecutionId: row.id,
    planId: row.plan_id,
    actionKey: row.action_key,
    type: row.type,
    targetRef: row.target_ref,
    operationKey: stableOperationKey(row.plan_id, row.action_key),
    status: row.status,
    action: row.action,
    ...(row.before_state === null ? {} : { beforeState: row.before_state }),
    ...(row.after_state === null ? {} : { afterState: row.after_state }),
    ...(row.receipt === null ? {} : { receipt: row.receipt }),
    attempts: row.attempts,
    leaseUntil: iso(row.lease_until),
    dispatchStartedAt: iso(row.dispatch_started_at),
    ...(row.error === null ? {} : { error: row.error }),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  });
}

async function readAction(pool: Pool, actionExecutionId: string): Promise<ActionExecutionRecord | null> {
  const result = await pool.query<ActionRow>(
    `SELECT id, plan_id, action_key, type, target_ref, status, action, before_state, after_state,
            receipt, attempts, lease_until, dispatch_started_at, error, started_at, finished_at
       FROM action_executions WHERE id = $1`,
    [actionExecutionId],
  );
  return result.rowCount === 1 ? rowToAction(result.rows[0]) : null;
}

/** PostgreSQL implementation over the existing foundation tables. */
export class PostgresExecutionPersistenceStore implements ExecutionPersistenceStore {
  constructor(private readonly pool: Pool) {}

  async createPlan(plan: ExecutionPlan): Promise<ExecutionPlan> {
    const parsed = ExecutionPlanSchema.parse(plan);
    const existing = await this.pool.query<PlanRow>(
      `SELECT id, task_id, kind, version, schema_version, prompt_version, model, payload, digest, created_at
         FROM plans WHERE id = $1 OR (task_id = $2 AND kind = $3 AND version = $4)
        ORDER BY id LIMIT 1`,
      [parsed.planId, parsed.taskId, parsed.kind, parsed.version],
    );
    if (existing.rowCount === 1) {
      const stored = rowToPlan(existing.rows[0]);
      if (JSON.stringify(stored) !== JSON.stringify(parsed)) throw new ExecutionPersistenceError("plan_immutable_conflict", "The plan version is already bound to different immutable content.");
      return stored;
    }
    try {
      await this.pool.query(
        `INSERT INTO plans (id, task_id, kind, version, schema_version, prompt_version, model, payload, digest, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::timestamptz)`,
        [parsed.planId, parsed.taskId, parsed.kind, parsed.version, parsed.schemaVersion, parsed.promptVersion, parsed.model, JSON.stringify(parsed.payload), parsed.digest, parsed.createdAt],
      );
    } catch (error) {
      throw new ExecutionPersistenceError("persistence_failure", "The immutable plan could not be persisted safely.", { cause: error });
    }
    return parsed;
  }

  async getPlan(planId: string): Promise<ExecutionPlan | null> {
    const result = await this.pool.query<PlanRow>(
      `SELECT id, task_id, kind, version, schema_version, prompt_version, model, payload, digest, created_at
         FROM plans WHERE id = $1`,
      [planId],
    );
    return result.rowCount === 1 ? rowToPlan(result.rows[0]) : null;
  }

  async createApproval(input: CreateApprovalInput): Promise<{ approval: ApprovalRecord; replay: boolean }> {
    const approval = ApprovalRecordSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const plan = await client.query<{ version: number; digest: string }>("SELECT version, digest FROM plans WHERE id = $1 FOR SHARE", [approval.planId]);
      if (plan.rowCount !== 1) throw new ExecutionPersistenceError("plan_not_found", "The approved plan does not exist.");
      if (plan.rows[0].version !== approval.planVersion || plan.rows[0].digest !== approval.planDigest) {
        throw new ExecutionPersistenceError("approval_conflict", "Approval does not match the immutable plan version and digest.");
      }
      const existing = await client.query<ApprovalRow>(
        `SELECT id, plan_id, plan_digest, actor_id, approved_at FROM approvals WHERE plan_id = $1 FOR UPDATE`,
        [approval.planId],
      );
      if (existing.rowCount === 1) {
        const stored = rowToApproval({ ...existing.rows[0], planVersion: approval.planVersion } as ApprovalRow & { planVersion?: number });
        const comparable = { ...stored, planVersion: approval.planVersion };
        if (JSON.stringify(comparable) !== JSON.stringify(approval)) throw new ExecutionPersistenceError("approval_conflict", "This plan already has a different immutable approval.");
        await client.query("COMMIT");
        return { approval, replay: true };
      }
      await client.query(
        `INSERT INTO approvals (id, plan_id, plan_digest, actor_id, approved_at) VALUES ($1, $2, $3, $4, $5::timestamptz)`,
        [approval.approvalId, approval.planId, approval.planDigest, approval.actorId, approval.approvedAt],
      );
      await client.query("COMMIT");
      return { approval, replay: false };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof ExecutionPersistenceError) throw error;
      throw new ExecutionPersistenceError("persistence_failure", "The immutable approval could not be persisted safely.", { cause: error });
    } finally {
      client.release();
    }
  }

  async getApproval(planId: string): Promise<ApprovalRecord | null> {
    const result = await this.pool.query<ApprovalRow>(
      `SELECT approvals.id, approvals.plan_id, approvals.plan_digest, approvals.actor_id, approvals.approved_at,
              plans.version AS plan_version
         FROM approvals JOIN plans ON plans.id = approvals.plan_id
        WHERE approvals.plan_id = $1`,
      [planId],
    );
    if (result.rowCount !== 1) return null;
    return ApprovalRecordSchema.parse({
      approvalId: result.rows[0].id,
      planId: result.rows[0].plan_id,
      planVersion: Number((result.rows[0] as ApprovalRow & { plan_version: number }).plan_version),
      planDigest: result.rows[0].plan_digest,
      actorId: result.rows[0].actor_id,
      approvedAt: iso(result.rows[0].approved_at),
    });
  }

  async ensureActionRows(inputs: readonly PlannedActionInput[]): Promise<readonly ActionExecutionRecord[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const records: ActionExecutionRecord[] = [];
      for (const input of inputs) {
        const candidate = actionRecord(input);
        await client.query(
          `INSERT INTO action_executions (id, plan_id, action_key, type, target_ref, status, action, attempts)
           VALUES ($1, $2, $3, $4, $5, 'planned', $6::jsonb, 0)
           ON CONFLICT (plan_id, action_key) DO NOTHING`,
          [candidate.actionExecutionId, candidate.planId, candidate.actionKey, candidate.type, candidate.targetRef, JSON.stringify(candidate.action)],
        );
        const stored = await client.query<ActionRow>(
          `SELECT id, plan_id, action_key, type, target_ref, status, action, before_state, after_state,
                  receipt, attempts, lease_until, dispatch_started_at, error, started_at, finished_at
             FROM action_executions WHERE plan_id = $1 AND action_key = $2 FOR UPDATE`,
          [candidate.planId, candidate.actionKey],
        );
        if (stored.rowCount !== 1) throw new ExecutionPersistenceError("persistence_failure", "The action ledger row could not be read after creation.");
        const record = rowToAction(stored.rows[0]);
        assertSameAction(record, candidate);
        records.push(record);
      }
      await client.query("COMMIT");
      return records;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof ExecutionPersistenceError) throw error;
      throw new ExecutionPersistenceError("persistence_failure", "The action ledger could not be created safely.", { cause: error });
    } finally {
      client.release();
    }
  }

  async getAction(actionExecutionId: string): Promise<ActionExecutionRecord | null> {
    return readAction(this.pool, actionExecutionId);
  }

  async listActions(planId: string): Promise<readonly ActionExecutionRecord[]> {
    const result = await this.pool.query<ActionRow>(
      `SELECT id, plan_id, action_key, type, target_ref, status, action, before_state, after_state,
              receipt, attempts, lease_until, dispatch_started_at, error, started_at, finished_at
         FROM action_executions WHERE plan_id = $1 ORDER BY action_key`,
      [planId],
    );
    return result.rows.map(rowToAction);
  }

  async claimAction(input: ClaimActionInput): Promise<{ claimed: boolean; record: ActionExecutionRecord }> {
    const result = await this.pool.query<ActionRow>(
      `UPDATE action_executions
          SET status = 'in_progress',
              attempts = attempts + 1,
              started_at = COALESCE(started_at, $2::timestamptz),
              lease_until = $3::timestamptz,
              dispatch_started_at = COALESCE($4::timestamptz, dispatch_started_at),
              finished_at = NULL,
              receipt = NULL,
              error = NULL
        WHERE id = $1
          AND status IN ('planned', 'retryable_failed')
          AND (lease_until IS NULL OR lease_until <= $2::timestamptz)
        RETURNING id, plan_id, action_key, type, target_ref, status, action, before_state, after_state,
                  receipt, attempts, lease_until, dispatch_started_at, error, started_at, finished_at`,
      [input.actionExecutionId, input.now, input.leaseUntil, input.dispatchStartedAt ?? null],
    );
    if (result.rowCount === 1) return { claimed: true, record: rowToAction(result.rows[0]) };
    const existing = await this.getAction(input.actionExecutionId);
    if (!existing) throw new ExecutionPersistenceError("action_not_found", "The action ledger row does not exist.");
    return { claimed: false, record: existing };
  }

  async recordActionState(input: RecordActionStateInput): Promise<ActionExecutionRecord> {
    const existing = await this.getAction(input.actionExecutionId);
    if (!existing) throw new ExecutionPersistenceError("action_not_found", "The action ledger row does not exist.");
    if (isTerminal(existing.status) && input.status !== existing.status) return existing;
    const result = await this.pool.query<ActionRow>(
      `UPDATE action_executions
          SET status = $2,
              before_state = COALESCE($3::jsonb, before_state),
              after_state = COALESCE($4::jsonb, after_state),
              receipt = $5::jsonb,
              error = $6::jsonb,
              dispatch_started_at = COALESCE($7::timestamptz, dispatch_started_at),
              lease_until = CASE WHEN $2 = 'in_progress' THEN lease_until ELSE NULL END,
              finished_at = CASE WHEN $2 = 'in_progress' THEN NULL ELSE $8::timestamptz END
        WHERE id = $1
        RETURNING id, plan_id, action_key, type, target_ref, status, action, before_state, after_state,
                  receipt, attempts, lease_until, dispatch_started_at, error, started_at, finished_at`,
      [input.actionExecutionId, input.status, input.beforeState ? JSON.stringify(input.beforeState) : null, input.afterState ? JSON.stringify(input.afterState) : null, input.receipt ? JSON.stringify(input.receipt) : null, input.error ? JSON.stringify(errorFor(input.error.code, input.error.retryable, input.error.safeMessage)) : null, input.dispatchStartedAt ?? null, input.now],
    );
    if (result.rowCount !== 1) throw new ExecutionPersistenceError("persistence_failure", "The action outcome could not be persisted safely.");
    return rowToAction(result.rows[0]);
  }

  async reconcileExpiredLease(actionExecutionId: string, now: string): Promise<ActionExecutionRecord> {
    const current = await this.getAction(actionExecutionId);
    if (!current) throw new ExecutionPersistenceError("action_not_found", "The action ledger row does not exist.");
    if (current.status !== "in_progress" || !current.leaseUntil || Date.parse(current.leaseUntil) > Date.parse(now)) return current;
    if (current.type === "mail.notify" || current.type === "mail.correct") {
      return this.recordActionState({
        actionExecutionId,
        status: "delivery_uncertain",
        now,
        receipt: { status: "delivery_uncertain", reason: "process_interrupted" },
        error: { code: "delivery_uncertain", retryable: false, safeMessage: "Gmail handoff could not be reconciled after the execution lease expired." },
      });
    }
    throw new ExecutionPersistenceError("lease_reconciliation_required", "An expired non-mail action requires provider-state reconciliation before retry.");
  }
}
