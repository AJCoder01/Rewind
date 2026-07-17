import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresExecutionPersistenceStore } from "@/lib/db/execution-store";
import { buildFixtureWorldPrRecord } from "@/lib/domain/fixture-world-pr";
import { createOpaqueId } from "@/lib/domain/ids";

type QueryCall = { sql: string; params: readonly unknown[] };

function actionRow(status: "in_progress" | "succeeded") {
  const record = buildFixtureWorldPrRecord("Move the Acme renewal meeting on 2026-08-20 to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees.", new Date("2026-07-16T00:00:00.000Z"));
  const action = record.planPayload.actions[1];
  return {
    id: createOpaqueId("act_"),
    plan_id: record.planPayload.planId,
    action_key: action.actionKey,
    type: action.type,
    target_ref: `calendar:${action.target.calendarId}:${action.target.providerEventId}`,
    status,
    action,
    before_state: null,
    after_state: null,
    receipt: status === "succeeded" ? {
      provider: "google_calendar",
      operation: "move",
      providerEventId: action.target.providerEventId,
      resultingEtag: "fixture-etag-after",
      verified: true,
    } : null,
    attempts: 1,
    lease_until: status === "in_progress" ? "2026-07-16T12:01:00.000Z" : null,
    dispatch_started_at: null,
    error: null,
    started_at: "2026-07-16T12:00:00.000Z",
    finished_at: status === "succeeded" ? "2026-07-16T12:00:10.000Z" : null,
  };
}

describe("PostgresExecutionPersistenceStore", () => {
  it("locks a ledger row and preserves an already-terminal outcome", async () => {
    const row = actionRow("succeeded");
    const calls: QueryCall[] = [];
    const client = {
      query: vi.fn(async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
        if (sql.includes("FROM action_executions WHERE id = $1 FOR UPDATE")) return { rowCount: 1, rows: [row] };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const store = new PostgresExecutionPersistenceStore({ connect: vi.fn(async () => client) } as unknown as Pool);

    const result = await store.recordActionState({
      actionExecutionId: row.id,
      status: "conflict",
      now: "2026-07-16T12:00:20.000Z",
      error: { code: "late_writer", retryable: false, safeMessage: "A stale writer attempted to replace a terminal action." },
    });

    expect(result).toMatchObject({ status: "succeeded", receipt: row.receipt });
    expect(calls.some(({ sql }) => sql.includes("FOR UPDATE"))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes("UPDATE action_executions"))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back a receipt that does not match the immutable action type", async () => {
    const row = actionRow("in_progress");
    const calls: QueryCall[] = [];
    const client = {
      query: vi.fn(async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
        if (sql.includes("FROM action_executions WHERE id = $1 FOR UPDATE")) return { rowCount: 1, rows: [row] };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const store = new PostgresExecutionPersistenceStore({ connect: vi.fn(async () => client) } as unknown as Pool);

    await expect(store.recordActionState({
      actionExecutionId: row.id,
      status: "succeeded",
      now: "2026-07-16T12:00:20.000Z",
      claimFence: { attempts: 1, leaseUntil: "2026-07-16T12:01:00.000Z" },
      receipt: { status: "sent", messageId: "gmail-message-s057" },
    })).rejects.toMatchObject({ code: "action_immutable_conflict" });

    expect(calls.some(({ sql }) => sql === "ROLLBACK")).toBe(true);
    expect(calls.some(({ sql }) => sql.includes("UPDATE action_executions"))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("locks the task and refuses approval when a newer initial pointer is active", async () => {
    const fixture = buildFixtureWorldPrRecord("Move the Acme renewal meeting on 2026-08-20 to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees.", new Date("2026-07-16T00:00:00.000Z"));
    const staleView = structuredClone(fixture.view);
    if (!staleView.activePlan || staleView.activePlan.pointer.kind !== "initial") throw new Error("Expected an initial fixture view.");
    staleView.activePlan.pointer = {
      ...staleView.activePlan.pointer,
      planId: "plan_s057_replacement_pointer_001",
      version: staleView.activePlan.pointer.version + 1,
      digest: `sha256:${"b".repeat(64)}`,
    };
    const calls: QueryCall[] = [];
    const client = {
      query: vi.fn(async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
        if (sql.includes("FROM plans JOIN tasks")) {
          return {
            rowCount: 1,
            rows: [{
              version: fixture.planPayload.version,
              digest: fixture.planPayload.digest,
              task_id: fixture.view.worldPrId,
              status: "preview_ready",
              read_model: staleView,
            }],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const store = new PostgresExecutionPersistenceStore({ connect: vi.fn(async () => client) } as unknown as Pool);

    await expect(store.createApproval({
      approvalId: createOpaqueId("approval_"),
      planId: fixture.planPayload.planId,
      planVersion: fixture.planPayload.version,
      planDigest: fixture.planPayload.digest,
      actorId: "demo-operator",
      approvedAt: "2026-07-16T12:00:00.000Z",
    })).rejects.toMatchObject({ code: "approval_conflict" });

    expect(calls.some(({ sql }) => sql.includes("FOR UPDATE OF plans, tasks"))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes("INSERT INTO approvals"))).toBe(false);
    expect(calls.some(({ sql }) => sql === "ROLLBACK")).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
