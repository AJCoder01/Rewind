import type { Pool, QueryResultRow } from "pg";
import {
  GmailDispatchIdentitySchema,
  GmailDispatchRecordSchema,
  type GmailDispatchIdentity,
  type GmailDispatchRecord,
} from "@/lib/contracts/gmail-delivery";
import { GmailSendReceiptSchema, type GmailSendReceipt } from "@/lib/contracts/provider-ports";
import { sha256Digest } from "@/lib/domain/digest";

export type GmailDispatchClaim = Readonly<{
  claimed: boolean;
  record: GmailDispatchRecord;
}>;

export interface GmailDispatchStore {
  read(actionId: string): Promise<GmailDispatchRecord | null>;
  claimForDispatch(identity: GmailDispatchIdentity, dispatchStartedAt: string): Promise<GmailDispatchClaim>;
  recordRetryableFailure(identity: GmailDispatchIdentity): Promise<GmailDispatchRecord>;
  recordOutcome(actionId: string, receipt: GmailSendReceipt): Promise<GmailDispatchRecord>;
  recordProcessInterrupted(actionId: string): Promise<GmailDispatchRecord>;
}

function copyRecord(record: GmailDispatchRecord): GmailDispatchRecord {
  return GmailDispatchRecordSchema.parse(JSON.parse(JSON.stringify(record)) as unknown);
}

function statusForReceipt(receipt: GmailSendReceipt): GmailDispatchRecord["status"] {
  if (receipt.status === "sent") return "succeeded";
  if (receipt.status === "permanent_failed") return "permanently_failed";
  return "delivery_uncertain";
}

function identityRecord(identity: GmailDispatchIdentity, status: GmailDispatchRecord["status"], dispatchStartedAt: string | null, receipt: GmailSendReceipt | null, errorCode: "local_preparation_failed" | null): GmailDispatchRecord {
  return GmailDispatchRecordSchema.parse({ ...GmailDispatchIdentitySchema.parse(identity), status, dispatchStartedAt, receipt, errorCode });
}

/** In-memory implementation used by deterministic tests only. */
export class MemoryGmailDispatchStore implements GmailDispatchStore {
  private readonly records = new Map<string, GmailDispatchRecord>();

  async claimForDispatch(identity: GmailDispatchIdentity, dispatchStartedAt: string): Promise<GmailDispatchClaim> {
    const parsedIdentity = GmailDispatchIdentitySchema.parse(identity);
    const existing = this.records.get(parsedIdentity.actionId);
    if (existing) {
      if (!sameIdentity(existing, parsedIdentity)) throw new Error("Gmail dispatch identity changed for the same action.");
      if (existing.status === "planned" || existing.status === "retryable_failed") {
        const claimed = identityRecord(parsedIdentity, "in_progress", dispatchStartedAt, null, null);
        this.records.set(parsedIdentity.actionId, claimed);
        return { claimed: true, record: copyRecord(claimed) };
      }
      return { claimed: false, record: copyRecord(existing) };
    }
    const claimed = identityRecord(parsedIdentity, "in_progress", dispatchStartedAt, null, null);
    this.records.set(parsedIdentity.actionId, claimed);
    return { claimed: true, record: copyRecord(claimed) };
  }

  async recordRetryableFailure(identity: GmailDispatchIdentity): Promise<GmailDispatchRecord> {
    const parsedIdentity = GmailDispatchIdentitySchema.parse(identity);
    const existing = this.records.get(parsedIdentity.actionId);
    if (existing) {
      if (!sameIdentity(existing, parsedIdentity)) throw new Error("Gmail dispatch identity changed for the same action.");
      if (existing.dispatchStartedAt !== null || existing.status === "succeeded" || existing.status === "permanently_failed" || existing.status === "delivery_uncertain") {
        return copyRecord(existing);
      }
    }
    const failed = identityRecord(parsedIdentity, "retryable_failed", null, null, "local_preparation_failed");
    this.records.set(parsedIdentity.actionId, failed);
    return copyRecord(failed);
  }

  async recordOutcome(actionId: string, receipt: GmailSendReceipt): Promise<GmailDispatchRecord> {
    const existing = this.require(actionId);
    const parsedReceipt = GmailSendReceiptSchema.parse(receipt);
    if (existing.dispatchStartedAt === null) throw new Error("Gmail outcome cannot be stored before dispatch is marked.");
    if (existing.status === "succeeded" || existing.status === "permanently_failed" || existing.status === "delivery_uncertain") return copyRecord(existing);
    const updated = identityRecord(identityFromRecord(existing), statusForReceipt(parsedReceipt), existing.dispatchStartedAt, parsedReceipt, null);
    this.records.set(actionId, updated);
    return copyRecord(updated);
  }

  async recordProcessInterrupted(actionId: string): Promise<GmailDispatchRecord> {
    const existing = this.require(actionId);
    if (existing.dispatchStartedAt === null) throw new Error("Interrupted Gmail dispatch has no persisted marker.");
    return this.recordOutcome(actionId, { status: "delivery_uncertain", reason: "process_interrupted" });
  }

  async read(actionId: string): Promise<GmailDispatchRecord | null> {
    const record = this.records.get(actionId);
    return record ? copyRecord(record) : null;
  }

  private require(actionId: string): GmailDispatchRecord {
    const record = this.records.get(actionId);
    if (!record) throw new Error("Gmail dispatch row does not exist.");
    return record;
  }
}

type GmailDispatchRow = QueryResultRow & {
  id: string;
  plan_id: string;
  action_key: string;
  status: string;
  action: unknown;
  receipt: unknown;
  error: unknown;
  dispatch_started_at: Date | string | null;
};

/**
 * PostgreSQL bridge for the foundation `action_executions` row. S046 owns row
 * creation and the full action ledger; S037 owns only the Gmail-safe claims
 * and outcome transitions exposed here.
 */
export class PostgresGmailDispatchStore implements GmailDispatchStore {
  constructor(private readonly pool: Pool) {}

  async claimForDispatch(identity: GmailDispatchIdentity, dispatchStartedAt: string): Promise<GmailDispatchClaim> {
    const parsedIdentity = GmailDispatchIdentitySchema.parse(identity);
    const claimed = await this.pool.query<GmailDispatchRow>(
      `UPDATE action_executions
          SET status = 'in_progress',
              attempts = attempts + 1,
              started_at = COALESCE(started_at, $4::timestamptz),
              dispatch_started_at = $4::timestamptz
        WHERE id = $1
          AND plan_id = $2
          AND action_key = $3
          AND type IN ('mail.notify', 'mail.correct')
          AND status IN ('planned', 'retryable_failed')
          AND dispatch_started_at IS NULL
        RETURNING id, plan_id, action_key, status, action, receipt, error, dispatch_started_at`,
      [parsedIdentity.actionId, parsedIdentity.planId, parsedIdentity.actionKey, dispatchStartedAt],
    );
    if (claimed.rowCount === 1) {
      return { claimed: true, record: rowToRecord(claimed.rows[0], parsedIdentity) };
    }

    const existing = await this.read(parsedIdentity.actionId);
    if (!existing) throw new Error("Gmail action row does not exist.");
    if (!sameIdentity(existing, parsedIdentity)) throw new Error("Gmail dispatch identity changed for the same action.");
    return { claimed: false, record: existing };
  }

  async recordRetryableFailure(identity: GmailDispatchIdentity): Promise<GmailDispatchRecord> {
    const parsedIdentity = GmailDispatchIdentitySchema.parse(identity);
    const result = await this.pool.query<GmailDispatchRow>(
      `UPDATE action_executions
          SET status = 'retryable_failed',
              error = $2::jsonb,
              finished_at = now()
        WHERE id = $1
          AND plan_id = $3
          AND action_key = $4
          AND type IN ('mail.notify', 'mail.correct')
          AND dispatch_started_at IS NULL
          AND status IN ('planned', 'retryable_failed')
        RETURNING id, plan_id, action_key, status, action, receipt, error, dispatch_started_at`,
      [parsedIdentity.actionId, JSON.stringify({ code: "local_preparation_failed" }), parsedIdentity.planId, parsedIdentity.actionKey],
    );
    if (result.rowCount === 1) return rowToRecord(result.rows[0], parsedIdentity);
    const existing = await this.read(parsedIdentity.actionId);
    if (!existing) throw new Error("Gmail action row does not exist.");
    return existing;
  }

  async recordOutcome(actionId: string, receipt: GmailSendReceipt): Promise<GmailDispatchRecord> {
    const parsedReceipt = GmailSendReceiptSchema.parse(receipt);
    const status = statusForReceipt(parsedReceipt);
    const result = await this.pool.query<GmailDispatchRow>(
      `UPDATE action_executions
          SET status = $2,
              receipt = $3::jsonb,
              error = NULL,
              finished_at = now()
        WHERE id = $1 AND type IN ('mail.notify', 'mail.correct') AND status = 'in_progress' AND dispatch_started_at IS NOT NULL
        RETURNING id, plan_id, action_key, status, action, receipt, error, dispatch_started_at`,
      [actionId, status, JSON.stringify(parsedReceipt)],
    );
    if (result.rowCount !== 1) {
      const existing = await this.read(actionId);
      if (existing?.status === "succeeded" || existing?.status === "permanently_failed" || existing?.status === "delivery_uncertain") return existing;
      throw new Error("Gmail action outcome could not be persisted after handoff.");
    }
    return rowToRecord(result.rows[0]);
  }

  async recordProcessInterrupted(actionId: string): Promise<GmailDispatchRecord> {
    return this.recordOutcome(actionId, { status: "delivery_uncertain", reason: "process_interrupted" });
  }

  async read(actionId: string): Promise<GmailDispatchRecord | null> {
    const result = await this.pool.query<GmailDispatchRow>(
      `SELECT id, plan_id, action_key, status, action, receipt, error, dispatch_started_at
         FROM action_executions
        WHERE id = $1`,
      [actionId],
    );
    return result.rowCount === 1 ? rowToRecord(result.rows[0]) : null;
  }
}

function rowToRecord(row: GmailDispatchRow, identity?: GmailDispatchIdentity): GmailDispatchRecord {
  const action = row.action && typeof row.action === "object" ? row.action as Record<string, unknown> : {};
  const desired = action.desired && typeof action.desired === "object" ? action.desired as Record<string, unknown> : {};
  const messageHash = action.messageHash ?? sha256Digest({ subject: desired.subject, bodyHash: desired.bodyHash, runId: desired.runId });
  const recipientDigest = action.recipientDigest ?? sha256Digest(Array.isArray(desired.to) ? desired.to.map((recipient) => String(recipient).toLowerCase()).sort() : []);
  const storedIdentity = identity ?? GmailDispatchIdentitySchema.parse({
    actionId: row.id,
    planId: row.plan_id,
    actionKey: row.action_key,
    messageHash,
    recipientDigest,
  });
  const receipt = row.receipt === null ? null : GmailSendReceiptSchema.parse(row.receipt);
  const errorCode = row.error && typeof row.error === "object" && (row.error as Record<string, unknown>).code === "local_preparation_failed"
    ? "local_preparation_failed"
    : null;
  return GmailDispatchRecordSchema.parse({
    ...storedIdentity,
    status: row.status,
    dispatchStartedAt: row.dispatch_started_at ? new Date(row.dispatch_started_at).toISOString() : null,
    receipt,
    errorCode,
  });
}

function sameIdentity(left: GmailDispatchIdentity, right: GmailDispatchIdentity): boolean {
  return left.actionId === right.actionId && left.planId === right.planId && left.actionKey === right.actionKey && left.messageHash === right.messageHash && left.recipientDigest === right.recipientDigest;
}

function identityFromRecord(record: GmailDispatchRecord): GmailDispatchIdentity {
  return {
    actionId: record.actionId,
    planId: record.planId,
    actionKey: record.actionKey,
    messageHash: record.messageHash,
    recipientDigest: record.recipientDigest,
  };
}
