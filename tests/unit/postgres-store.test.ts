import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { InitialPlanPayloadSchema } from "@/lib/contracts/v1";
import { PostgresWorldPrStore } from "@/lib/db/postgres-store";
import { sha256Digest } from "@/lib/domain/digest";
import { buildFixtureWorldPrRecord } from "@/lib/domain/fixture-world-pr";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";

type QueryCall = { sql: string; params: readonly unknown[] };

describe("PostgresWorldPrStore", () => {
  it("claims idempotency, inserts the task before its lock, and stores the hashed plan payload", async () => {
    const calls: QueryCall[] = [];
    async function query(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("RETURNING key")) return { rowCount: 1, rows: [{ key: "idempotency-key-0001" }] };
      if (sql.includes("RETURNING scenario_key")) return { rowCount: 1, rows: [{ scenario_key: "acme-demo" }] };
      return { rowCount: 1, rows: [] };
    }
    const client = {
      query: vi.fn(query),
      release: vi.fn(),
    };
    const pool = { query: vi.fn(query), connect: vi.fn(async () => client) } as unknown as Pool;
    const store = new PostgresWorldPrStore(pool);

    const result = await store.createInitial({
      actorId: "test:operator",
      endpoint: "POST /api/v1/world-prs",
      idempotencyKey: "idempotency-key-0001",
      bodyHash: sha256Digest({ request: SUPPORTED_SCENARIO_REQUEST }),
      request: SUPPORTED_SCENARIO_REQUEST,
      requestId: "req_00000001",
      reviewUrl: "http://localhost:3000/pr/{worldPrId}",
    });

    const taskIndex = calls.findIndex(({ sql }) => sql.includes("INSERT INTO tasks"));
    const scenarioLockIndex = calls.findIndex(({ sql }) => sql.includes("INSERT INTO scenario_locks"));
    expect(taskIndex).toBeGreaterThan(-1);
    expect(scenarioLockIndex).toBeGreaterThan(taskIndex);

    const planCall = calls.find(({ sql }) => sql.includes("INSERT INTO plans"));
    expect(planCall).toBeDefined();
    const payload = InitialPlanPayloadSchema.parse(JSON.parse(String(planCall?.params[2])));
    const { digest, ...core } = payload;
    expect(sha256Digest(core)).toBe(digest);
    expect(result.planPayload).toEqual(payload);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("replays a completed claim without entering the planning transaction", async () => {
    const stored = buildFixtureWorldPrRecord(SUPPORTED_SCENARIO_REQUEST, new Date("2026-07-14T00:00:00.000Z"));
    const bodyHash = sha256Digest({ request: SUPPORTED_SCENARIO_REQUEST });
    const storedResponse = {
      worldPrId: stored.view.worldPrId,
      status: "preview_ready",
      reviewUrl: `http://localhost:3000/pr/${stored.view.worldPrId}`,
      requestId: "req_original1",
    };
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes("RETURNING key")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM idempotency_records")) {
        return {
          rowCount: 1,
          rows: [{ body_hash: bodyHash, response: storedResponse, resource_id: stored.view.worldPrId, status: "completed" }],
        };
      }
      if (sql.includes("JOIN plans")) {
        return { rowCount: 1, rows: [{ read_model: stored.view, payload: stored.planPayload }] };
      }
      throw new Error(`Unexpected SQL in replay test: ${sql}`);
    });
    const connect = vi.fn();
    const store = new PostgresWorldPrStore({ query: poolQuery, connect } as unknown as Pool);

    const replay = await store.createInitial({
      actorId: "test:operator",
      endpoint: "POST /api/v1/world-prs",
      idempotencyKey: "idempotency-key-0001",
      bodyHash,
      request: SUPPORTED_SCENARIO_REQUEST,
      requestId: "req_replay001",
      reviewUrl: "http://localhost:3000/pr/{worldPrId}",
    });

    expect(replay.replay).toBe(true);
    expect(replay.response).toEqual({ ...storedResponse, replayPending: true });
    expect(connect).not.toHaveBeenCalled();
  });
});
