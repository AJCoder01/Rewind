import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresGmailLiveProofRepository } from "@/lib/db/gmail-live-proof";
import { buildGmailLiveProofPlan, completedGmailLiveProofReadModel, gmailLiveProofConfigurationFromEnvironment } from "@/lib/services/gmail-live-proof";
import type { ApplicationEnvironment } from "@/lib/config/environment";

const configuration = gmailLiveProofConfigurationFromEnvironment({
  REWIND_GOOGLE_EXPECTED_SUB: "google-subject",
  REWIND_GOOGLE_EXPECTED_EMAIL: "owner@example.com",
  REWIND_RECIPIENT_ALLOWLIST: { UK: ["uk-team@example.com"], US: ["us-team@example.com"] },
  REWIND_DEMO_DATE: "2026-08-20",
} as ApplicationEnvironment);

describe("Postgres S038 Gmail proof repository", () => {
  it("creates task, immutable plan, unique action row, and redacted audit atomically", async () => {
    const plan = buildGmailLiveProofPlan(configuration, "run_s038_store_001");
    const clientCalls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
        clientCalls.push({ sql, values });
        return { rowCount: 1, rows: [{ id: "ok" }] };
      }),
      release: vi.fn(),
    };
    let readCount = 0;
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => {
        readCount += 1;
        if (sql.includes("FROM tasks")) {
          return {
            rowCount: 1,
            rows: [{
              payload: plan,
              action_status: "planned",
              attempts: 0,
              dispatch_started_at: null,
              receipt: null,
              read_model: {
                schemaVersion: "gmail-live-proof.v1",
                operation: "gmail_live_proof",
                status: "planned",
                runId: plan.message.runId,
                actionId: plan.actionId,
                recipientDigest: plan.recipientDigest,
                replayKey: plan.replayKey,
                replayVerified: false,
                firstStatus: "pending",
                replayStatus: "pending",
                updatedAt: "2026-07-16T10:00:00.000Z",
              },
            }],
          };
        }
        return { rowCount: 0, rows: [{ present: false }] };
      }),
    } as unknown as Pool;
    const repository = new PostgresGmailLiveProofRepository(pool);
    const record = await repository.create(plan, new Date("2026-07-16T10:00:00.000Z"));

    expect(record).toMatchObject({ actionStatus: "planned", attempts: 0, plan: { digest: plan.digest } });
    expect(clientCalls.map(({ sql }) => sql.trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "BEGIN",
      "INSERT INTO tasks",
      "INSERT INTO plans",
      "INSERT INTO action_executions",
      "INSERT INTO audit_events",
      "COMMIT",
    ]);
    const actionInsert = clientCalls.find(({ sql }) => sql.includes("INSERT INTO action_executions"));
    expect(actionInsert?.sql).toContain("'mail.notify'");
    expect(String(actionInsert?.values?.[3])).toBe(plan.recipientDigest);
    expect(readCount).toBe(1);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("finalizes completion and replay evidence without altering the action receipt", async () => {
    const plan = buildGmailLiveProofPlan(configuration, "run_s038_store_001");
    const first = { status: "sent" as const, receipt: { status: "sent" as const, messageId: "gmail-message-store" }, replay: false, dispatchStartedAt: "2026-07-16T10:00:00.000Z" };
    const replay = { ...first, replay: true };
    const readModel = completedGmailLiveProofReadModel(plan, first, replay, new Date("2026-07-16T10:01:00.000Z"));
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        return { rowCount: 1, rows: [{ id: plan.taskId }] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    await new PostgresGmailLiveProofRepository(pool).finish(readModel);
    expect(calls.some((sql) => sql.includes("UPDATE tasks"))).toBe(true);
    expect(calls.some((sql) => sql.includes("UPDATE action_executions"))).toBe(false);
    expect(calls.some((sql) => sql.includes("INSERT INTO audit_events"))).toBe(true);
  });
});
