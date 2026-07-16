import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresGmailDispatchStore } from "@/lib/db/gmail-dispatch";
import type { GmailDispatchIdentity } from "@/lib/contracts/gmail-delivery";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";

const identity: GmailDispatchIdentity = {
  actionId: "action_s037_sql",
  planId: "plan_s037_sql",
  actionKey: "initial.mail.notify",
  messageHash: sha256Digest({ subject: "subject", bodyHash: sha256Text("body"), runId: "run_s037_sql" }),
  recipientDigest: sha256Digest(["uk-ops@example.test"]),
};

const action = {
  desired: {
    subject: "subject",
    bodyHash: sha256Text("body"),
    runId: "run_s037_sql",
    to: ["uk-ops@example.test"],
  },
};

function row(status: string, receipt: unknown = null, error: unknown = null) {
  return {
    id: identity.actionId,
    plan_id: identity.planId,
    action_key: identity.actionKey,
    status,
    action,
    receipt,
    error,
    dispatch_started_at: "2026-07-16T10:00:00.000Z",
  };
}

describe("Postgres Gmail dispatch bridge", () => {
  it("claims the existing action row with the marker in the same update and stores the typed outcome", async () => {
    const calls: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes("SET status = 'in_progress'")) return { rowCount: 1, rows: [row("in_progress")] };
        if (sql.includes("SET status = $2")) return { rowCount: 1, rows: [row("succeeded", { status: "sent", messageId: "gmail-message-sql" })] };
        return { rowCount: 0, rows: [] };
      }),
    } as unknown as Pool;
    const store = new PostgresGmailDispatchStore(pool);

    const claim = await store.claimForDispatch(identity, "2026-07-16T10:00:00.000Z");
    const outcome = await store.recordOutcome(identity.actionId, { status: "sent", messageId: "gmail-message-sql" });

    expect(claim.claimed).toBe(true);
    expect(claim.record).toMatchObject({ status: "in_progress", dispatchStartedAt: "2026-07-16T10:00:00.000Z" });
    expect(outcome).toMatchObject({ status: "succeeded", receipt: { status: "sent", messageId: "gmail-message-sql" } });
    expect(calls[0]).toContain("dispatch_started_at = $4::timestamptz");
    expect(calls[0]).toContain("type IN ('mail.notify', 'mail.correct')");
    expect(calls[1]).toContain("dispatch_started_at IS NOT NULL");
  });

  it("maps a persisted local failure without ever manufacturing a dispatch marker", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SET status = 'retryable_failed'")) {
          return { rowCount: 1, rows: [{ ...row("retryable_failed", null, { code: "local_preparation_failed" }), dispatch_started_at: null }] };
        }
        return { rowCount: 0, rows: [] };
      }),
    } as unknown as Pool;
    const store = new PostgresGmailDispatchStore(pool);
    const result = await store.recordRetryableFailure(identity);
    expect(result).toMatchObject({ status: "retryable_failed", dispatchStartedAt: null, errorCode: "local_preparation_failed" });
  });
});
