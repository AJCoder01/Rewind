import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  GMAIL_LIVE_PROOF_ACTION_ID,
  GMAIL_LIVE_PROOF_CONTRACT_VERSION,
  GMAIL_LIVE_PROOF_PLAN_ID,
  GMAIL_LIVE_PROOF_TASK_ID,
  GmailLiveProofActionSchema,
  GmailLiveProofPlanSchema,
  GmailLiveProofReadModelSchema,
  GmailLiveProofStoredRecordSchema,
  type GmailLiveProofPlan,
  type GmailLiveProofReadModel,
  type GmailLiveProofStoredRecord,
} from "@/lib/contracts/gmail-live-proof";
import { GmailSendReceiptSchema } from "@/lib/contracts/provider-ports";
import { initialGmailLiveProofReadModel } from "@/lib/services/gmail-live-proof";

export interface GmailLiveProofRepository {
  read(): Promise<GmailLiveProofStoredRecord | null>;
  create(plan: GmailLiveProofPlan, now: Date): Promise<GmailLiveProofStoredRecord>;
  finish(readModel: GmailLiveProofReadModel): Promise<void>;
}

type GmailLiveProofRow = QueryResultRow & {
  payload: unknown;
  action_status: string;
  attempts: number;
  dispatch_started_at: Date | string | null;
  receipt: unknown;
  read_model: unknown;
};

export class PostgresGmailLiveProofRepository implements GmailLiveProofRepository {
  constructor(private readonly pool: Pool) {}

  async read(): Promise<GmailLiveProofStoredRecord | null> {
    const result = await this.pool.query<GmailLiveProofRow>(
      `SELECT plans.payload,
              action_executions.status AS action_status,
              action_executions.attempts,
              action_executions.dispatch_started_at,
              action_executions.receipt,
              tasks.read_model
         FROM tasks
         JOIN plans ON plans.task_id = tasks.id AND plans.id = $2
         JOIN action_executions ON action_executions.plan_id = plans.id AND action_executions.id = $3
        WHERE tasks.id = $1`,
      [GMAIL_LIVE_PROOF_TASK_ID, GMAIL_LIVE_PROOF_PLAN_ID, GMAIL_LIVE_PROOF_ACTION_ID],
    );
    if (result.rowCount === 1) return rowToRecord(result.rows[0]);
    const residue = await this.pool.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM tasks WHERE id = $1
         UNION ALL SELECT 1 FROM plans WHERE id = $2
         UNION ALL SELECT 1 FROM action_executions WHERE id = $3
       ) AS present`,
      [GMAIL_LIVE_PROOF_TASK_ID, GMAIL_LIVE_PROOF_PLAN_ID, GMAIL_LIVE_PROOF_ACTION_ID],
    );
    if (residue.rows[0]?.present) throw new Error("The Gmail proof ledger is incomplete; no send is permitted.");
    return null;
  }

  async create(plan: GmailLiveProofPlan, now: Date): Promise<GmailLiveProofStoredRecord> {
    const parsed = GmailLiveProofPlanSchema.parse(plan);
    const readModel = initialGmailLiveProofReadModel(parsed, now);
    const action = GmailLiveProofActionSchema.parse({
      schemaVersion: GMAIL_LIVE_PROOF_CONTRACT_VERSION,
      source: "s038_tty_admin_exception",
      replayKey: parsed.replayKey,
      messageHash: parsed.messageHash,
      recipientDigest: parsed.recipientDigest,
      desired: parsed.message,
    });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO tasks (id, run_id, request, status, read_model, created_at, updated_at)
         VALUES ($1, $2, $3, 'executing', $4::jsonb, $5, $5)`,
        [parsed.taskId, parsed.message.runId, "S038 controlled Gmail live proof.", JSON.stringify(readModel), now],
      );
      await client.query(
        `INSERT INTO plans (id, task_id, kind, version, schema_version, payload, digest, created_at)
         VALUES ($1, $2, 'initial', 1, $3, $4::jsonb, $5, $6)`,
        [parsed.planId, parsed.taskId, parsed.schemaVersion, JSON.stringify(parsed), parsed.digest, now],
      );
      await client.query(
        `INSERT INTO action_executions (id, plan_id, action_key, type, target_ref, status, action)
         VALUES ($1, $2, $3, 'mail.notify', $4, 'planned', $5::jsonb)`,
        [parsed.actionId, parsed.planId, parsed.actionKey, parsed.recipientDigest, JSON.stringify(action)],
      );
      await insertAudit(client, parsed.taskId, "demo.gmail_live_proof.created", {
        schemaVersion: parsed.schemaVersion,
        actionId: parsed.actionId,
        replayKey: parsed.replayKey,
        recipientDigest: parsed.recipientDigest,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const record = await this.read();
    if (!record) throw new Error("The Gmail proof ledger was not persisted.");
    return record;
  }

  async finish(readModel: GmailLiveProofReadModel): Promise<void> {
    const parsed = GmailLiveProofReadModelSchema.parse(readModel);
    const taskStatus = parsed.status === "completed" ? "completed" : "attention_required";
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE tasks
            SET status = $2,
                read_model = $3::jsonb,
                updated_at = $4
          WHERE id = $1
          RETURNING id`,
        [GMAIL_LIVE_PROOF_TASK_ID, taskStatus, JSON.stringify(parsed), parsed.updatedAt],
      );
      if (result.rowCount !== 1) throw new Error("The Gmail proof task is missing.");
      await insertAudit(client, GMAIL_LIVE_PROOF_TASK_ID, "demo.gmail_live_proof.finished", {
        schemaVersion: parsed.schemaVersion,
        actionId: parsed.actionId,
        replayKey: parsed.replayKey,
        recipientDigest: parsed.recipientDigest,
        status: parsed.status,
        firstStatus: parsed.firstStatus,
        replayStatus: parsed.replayStatus,
        replayVerified: parsed.replayVerified,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function rowToRecord(row: GmailLiveProofRow): GmailLiveProofStoredRecord {
  return GmailLiveProofStoredRecordSchema.parse({
    plan: GmailLiveProofPlanSchema.parse(row.payload),
    actionStatus: row.action_status,
    attempts: row.attempts,
    dispatchStartedAt: row.dispatch_started_at ? new Date(row.dispatch_started_at).toISOString() : null,
    receipt: row.receipt === null ? null : GmailSendReceiptSchema.parse(row.receipt),
    readModel: GmailLiveProofReadModelSchema.parse(row.read_model),
  });
}

async function insertAudit(client: PoolClient, taskId: string, eventType: string, metadata: Readonly<Record<string, unknown>>): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (task_id, event_type, metadata, occurred_at)
     VALUES ($1, $2, $3::jsonb, now())`,
    [taskId, eventType, JSON.stringify(metadata)],
  );
}
