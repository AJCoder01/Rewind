import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { PostgresWorldPrStore } from "@/lib/db/postgres-store";
import { isInitialPlanView } from "@/lib/contracts/v1";
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
    const payload = VerifiedInitialPlanPayloadSchema.parse(JSON.parse(String(planCall?.params[2])));
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
    expect(replay.response).toEqual(storedResponse);
    expect(connect).not.toHaveBeenCalled();
  });

  it("returns the current analyzing state for an in-progress identical replay without waiting or starting a second transaction", async () => {
    const stored = buildFixtureWorldPrRecord(SUPPORTED_SCENARIO_REQUEST, new Date("2026-07-14T00:00:00.000Z"));
    const bodyHash = sha256Digest({ request: SUPPORTED_SCENARIO_REQUEST });
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes("RETURNING key")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM idempotency_records")) {
        return { rowCount: 1, rows: [{ body_hash: bodyHash, response: null, resource_id: stored.view.worldPrId, status: "in_progress" }] };
      }
      if (sql.includes("JOIN plans")) return { rowCount: 0, rows: [] };
      if (sql === "SELECT read_model FROM tasks WHERE id = $1") return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL in in-progress replay test: ${sql}`);
    });
    const connect = vi.fn();
    const store = new PostgresWorldPrStore({ query: poolQuery, connect } as unknown as Pool);

    const replay = await store.createInitial({
      actorId: "test:operator",
      endpoint: "POST /api/v1/world-prs",
      idempotencyKey: "idempotency-key-in-progress",
      bodyHash,
      request: SUPPORTED_SCENARIO_REQUEST,
      requestId: "req_in_progress",
      reviewUrl: "http://localhost:3000/pr/{worldPrId}",
    });

    expect(replay.replay).toBe(true);
    expect(replay.response).toMatchObject({ status: "analyzing", replayPending: true });
    expect(replay.response.worldPrId).toBe(stored.view.worldPrId);
    expect(replay.view.worldPrId).toBe(stored.view.worldPrId);
    expect(connect).not.toHaveBeenCalled();
  });

  it("marks a claimed idempotency record failed when client acquisition fails", async () => {
    const calls: QueryCall[] = [];
    const poolQuery = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("RETURNING key")) return { rowCount: 1, rows: [{ key: "idempotency-key-0001" }] };
      if (sql.includes("SET status = 'failed'")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL in connection-failure test: ${sql}`);
    });
    const connect = vi.fn(async () => {
      throw new Error("database connection unavailable");
    });
    const store = new PostgresWorldPrStore({ query: poolQuery, connect } as unknown as Pool);

    await expect(
      store.createInitial({
        actorId: "test:operator",
        endpoint: "POST /api/v1/world-prs",
        idempotencyKey: "idempotency-key-0001",
        bodyHash: sha256Digest({ request: SUPPORTED_SCENARIO_REQUEST }),
        request: SUPPORTED_SCENARIO_REQUEST,
        requestId: "req_connectfail",
        reviewUrl: "http://localhost:3000/pr/{worldPrId}",
      }),
    ).rejects.toThrow("The request could not be recorded safely");

    expect(calls.some(({ sql }) => sql.includes("SET status = 'failed'"))).toBe(true);
  });

  it("reads a persisted clarification that intentionally has no plan", async () => {
    const stored = buildFixtureWorldPrRecord(SUPPORTED_SCENARIO_REQUEST, new Date("2026-07-14T00:00:00.000Z"));
    const clarification = structuredClone(stored.view);
    clarification.status = "clarification_required";
    delete clarification.activePlan;
    delete clarification.runId;
    clarification.clarification = {
      question: "Which Acme region did you intend?",
      candidates: [
        { candidateId: "cal_event_acme_uk", label: "Acme UK renewal" },
        { candidateId: "cal_event_acme_us", label: "Acme US renewal" },
      ],
    };
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql === "SELECT read_model FROM tasks WHERE id = $1") return { rowCount: 1, rows: [{ read_model: clarification }] };
      throw new Error(`Plan lookup must not run for clarification state: ${sql}`);
    });
    const store = new PostgresWorldPrStore({ query: poolQuery } as unknown as Pool);

    await expect(store.get(clarification.worldPrId)).resolves.toEqual(clarification);
    expect(poolQuery).toHaveBeenCalledOnce();
  });

  it("rejects a human-visible read model that disagrees with its immutable payload", async () => {
    const stored = buildFixtureWorldPrRecord(SUPPORTED_SCENARIO_REQUEST, new Date("2026-07-14T00:00:00.000Z"));
    const tamperedView = structuredClone(stored.view);
    if (!tamperedView.activePlan || !isInitialPlanView(tamperedView.activePlan)) throw new Error("Fixture must contain an initial plan");
    tamperedView.activePlan.selectedCandidate.label = "Acme US renewal";
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql === "SELECT read_model FROM tasks WHERE id = $1") return { rowCount: 1, rows: [{ read_model: tamperedView }] };
      if (sql.includes("JOIN plans")) return { rowCount: 1, rows: [{ read_model: tamperedView, payload: stored.planPayload }] };
      throw new Error(`Unexpected SQL in consistency test: ${sql}`);
    });
    const store = new PostgresWorldPrStore({ query: poolQuery } as unknown as Pool);

    await expect(store.get(stored.view.worldPrId)).rejects.toThrow("does not match its immutable plan payload");
  });
});
