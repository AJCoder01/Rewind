import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { VerifiedInitialPlanPayloadSchema } from "@/lib/contracts/initial-plan-server";
import { PostgresWorldPrStore } from "@/lib/db/postgres-store";
import { isInitialPlanView, WorldPrViewSchema } from "@/lib/contracts/v1";
import { sha256Digest } from "@/lib/domain/digest";
import { buildFixtureWorldPrRecord } from "@/lib/domain/fixture-world-pr";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";

type QueryCall = { sql: string; params: readonly unknown[] };

describe("PostgresWorldPrStore", () => {
  it("persists the explicitly non-effecting G1 slice in production mode", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const calls: QueryCall[] = [];
    async function query(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes("RETURNING key")) return { rowCount: 1, rows: [{ key: "production-g1-key-0001" }] };
      if (sql.includes("RETURNING scenario_key")) return { rowCount: 1, rows: [{ scenario_key: "acme-demo" }] };
      return { rowCount: 1, rows: [] };
    }
    const client = { query: vi.fn(query), release: vi.fn() };
    const pool = { query: vi.fn(query), connect: vi.fn(async () => client) } as unknown as Pool;
    const store = new PostgresWorldPrStore(pool);

    try {
      const result = await store.createInitial({
        actorId: "mcp:scoped-token",
        endpoint: "POST /api/v1/world-prs",
        idempotencyKey: "production-g1-key-0001",
        bodyHash: sha256Digest({ request: SUPPORTED_SCENARIO_REQUEST }),
        request: SUPPORTED_SCENARIO_REQUEST,
        requestId: "req_production_g1",
        reviewUrl: "https://rewind.example.test/pr/{worldPrId}",
      });

      expect(result.response.status).toBe("preview_ready");
      expect(calls.some(({ sql }) => sql.includes("INSERT INTO tasks"))).toBe(true);
      expect(client.release).toHaveBeenCalledOnce();
    } finally {
      if (previousNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      else (process.env as Record<string, string | undefined>).NODE_ENV = previousNodeEnv;
    }
  });

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
      if (sql === "SELECT read_model FROM tasks WHERE id = $1") {
        return { rowCount: 1, rows: [{ read_model: stored.view }] };
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

  it("uses the current durable mutation-claim token when replaying or recovering a pending approval", async () => {
    const stored = buildFixtureWorldPrRecord(SUPPORTED_SCENARIO_REQUEST, new Date("2026-07-14T00:00:00.000Z"));
    const bodyHash = sha256Digest({ worldPrId: stored.view.worldPrId, request: { planId: stored.planPayload.planId, planVersion: 1, planDigest: stored.planPayload.digest } });
    const calls: QueryCall[] = [];
    let reads = 0;
    const poolQuery = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO idempotency_records")) return { rowCount: 0, rows: [] };
      if (sql.includes("SELECT body_hash, response, resource_id, status")) {
        reads += 1;
        return {
          rowCount: 1,
          rows: [{
            body_hash: bodyHash,
            response: { claimToken: reads === 1 ? "idem_old_claim" : "idem_current_claim" },
            resource_id: stored.view.worldPrId,
            status: "in_progress",
          }],
        };
      }
      if (sql.includes("SET response = $5::jsonb, updated_at = now()")) return { rowCount: 0, rows: [] };
      if (sql.includes("SET status = 'completed'")) return { rowCount: params.at(-1) === "idem_current_claim" ? 1 : 0, rows: [] };
      throw new Error(`Unexpected SQL in mutation-claim test: ${sql}`);
    });
    const store = new PostgresWorldPrStore({ query: poolQuery } as unknown as Pool);
    const input = {
      actorId: "test:operator",
      endpoint: `POST /api/v1/world-prs/${stored.view.worldPrId}/approvals/initial`,
      idempotencyKey: "postgres-mutation-claim-fence-0001",
      bodyHash,
      worldPrId: stored.view.worldPrId,
      requestId: "req_postgres_claim_fence_0001",
      claimedAt: "2026-07-16T12:00:00.000Z",
    };
    const claim = await store.claimMutation(input);
    expect(claim).toEqual({ kind: "replay_pending", claimToken: "idem_current_claim" });
    if (claim.kind !== "replay_pending") throw new Error("Expected the current pending mutation claim.");
    const response = {
      worldPrId: stored.view.worldPrId,
      status: "preview_ready" as const,
      activePlan: stored.view.activePlan!.pointer,
      requestId: input.requestId,
    };

    await expect(store.recoverMutation({ ...input, claimToken: "idem_old_claim" }, response)).rejects.toThrow("could not be recovered safely");
    await expect(store.recoverMutation({ ...input, claimToken: claim.claimToken }, response)).resolves.toBeUndefined();
    expect(calls.some(({ sql }) => sql.includes("(response ->> 'claimToken') = $6"))).toBe(true);
  });

  it("durably marks an expired reclaimable planning lease failed before admitting the next scenario", async () => {
    const expired = buildFixtureWorldPrRecord(SUPPORTED_SCENARIO_REQUEST, new Date("2026-07-14T00:00:00.000Z"));
    const clientCalls: QueryCall[] = [];
    const client = {
      query: vi.fn(async (sql: string, params: readonly unknown[] = []) => {
        clientCalls.push({ sql, params });
        if (sql.includes("SELECT id FROM prevention_rules")) return { rowCount: 0, rows: [] };
        if (sql.includes("RETURNING locks.task_id")) return { rowCount: 1, rows: [{ task_id: expired.view.worldPrId }] };
        if (sql === "SELECT read_model FROM tasks WHERE id = $1 FOR UPDATE") return { rowCount: 1, rows: [{ read_model: expired.view }] };
        if (sql.includes("RETURNING scenario_key")) return { rowCount: 1, rows: [{ scenario_key: "acme-demo" }] };
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string) => sql.includes("RETURNING key")
        ? { rowCount: 1, rows: [{ key: "idempotency-key-lease-1" }] }
        : { rowCount: 1, rows: [] }),
      connect: vi.fn(async () => client),
    } as unknown as Pool;
    const store = new PostgresWorldPrStore(pool);

    await expect(store.createInitial({
      actorId: "demo-operator",
      endpoint: "POST /api/v1/world-prs",
      idempotencyKey: "idempotency-key-lease-1",
      bodyHash: sha256Digest({ request: SUPPORTED_SCENARIO_REQUEST }),
      request: SUPPORTED_SCENARIO_REQUEST,
      requestId: "req_lease_reclaim",
      reviewUrl: "http://localhost:3000/pr/{worldPrId}",
    })).resolves.toMatchObject({ response: { status: "preview_ready" } });

    const failedUpdate = clientCalls.find(({ sql }) => sql.includes("SET status = 'failed'"));
    expect(failedUpdate).toBeDefined();
    const failedView = WorldPrViewSchema.parse(JSON.parse(String(failedUpdate?.params[1])));
    expect(failedView.status).toBe("failed");
    expect(failedView.runId).toBeUndefined();
    expect(failedView.activePlan).toBeUndefined();
    expect(clientCalls.some(({ params }) => params.includes("planning.lease_expired"))).toBe(true);
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

  it("allows the dashboard operator to read a scoped-MCP World PR but rejects unrelated actors", async () => {
    const stored = buildFixtureWorldPrRecord(SUPPORTED_SCENARIO_REQUEST, new Date("2026-07-14T00:00:00.000Z"));
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql === "SELECT read_model FROM tasks WHERE id = $1") return { rowCount: 1, rows: [{ read_model: stored.view }] };
      if (sql.includes("SELECT actor_id")) return { rowCount: 1, rows: [{ actor_id: "mcp:scoped-token" }] };
      if (sql.includes("JOIN plans")) return { rowCount: 1, rows: [{ read_model: stored.view, payload: stored.planPayload }] };
      throw new Error(`Unexpected SQL in workspace-scope test: ${sql}`);
    });
    const store = new PostgresWorldPrStore({ query: poolQuery } as unknown as Pool);

    await expect(store.get(stored.view.worldPrId, "demo-operator")).resolves.toMatchObject({ worldPrId: stored.view.worldPrId });
    await expect(store.get(stored.view.worldPrId, "test:other")).rejects.toThrow("outside the authenticated workspace scope");
  });

  it("returns the current durable state instead of crashing when a completed create replay refers to an expired planning lease", async () => {
    const stored = buildFixtureWorldPrRecord(SUPPORTED_SCENARIO_REQUEST, new Date("2026-07-14T00:00:00.000Z"));
    const failed = structuredClone(stored.view);
    failed.status = "failed";
    delete failed.runId;
    delete failed.activePlan;
    const bodyHash = sha256Digest({ request: SUPPORTED_SCENARIO_REQUEST });
    const storedResponse = {
      worldPrId: stored.view.worldPrId,
      status: "preview_ready",
      reviewUrl: `http://localhost:3000/pr/${stored.view.worldPrId}`,
      requestId: "req_original1",
    };
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes("RETURNING key")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM idempotency_records")) return { rowCount: 1, rows: [{ body_hash: bodyHash, response: storedResponse, resource_id: stored.view.worldPrId, status: "completed" }] };
      if (sql === "SELECT read_model FROM tasks WHERE id = $1") return { rowCount: 1, rows: [{ read_model: failed }] };
      throw new Error(`An expired-plan replay must not reload an immutable preview: ${sql}`);
    });
    const store = new PostgresWorldPrStore({ query: poolQuery } as unknown as Pool);

    const replay = await store.createInitial({
      actorId: "test:operator",
      endpoint: "POST /api/v1/world-prs",
      idempotencyKey: "idempotency-key-expired-1",
      bodyHash,
      request: SUPPORTED_SCENARIO_REQUEST,
      requestId: "req_replay_expired",
      reviewUrl: "http://localhost:3000/pr/{worldPrId}",
    });

    expect(replay.replay).toBe(true);
    expect(replay.response).toEqual(storedResponse);
    expect(replay.view.status).toBe("failed");
  });

  it("reports an in-progress cancellation as pending rather than fabricating a cancelled result", async () => {
    const stored = buildFixtureWorldPrRecord(SUPPORTED_SCENARIO_REQUEST, new Date("2026-07-14T00:00:00.000Z"));
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes("RETURNING key")) return { rowCount: 0, rows: [] };
      if (sql.includes("SELECT actor_id")) return { rowCount: 1, rows: [{ actor_id: "demo-operator" }] };
      if (sql.includes("FROM idempotency_records")) return { rowCount: 1, rows: [{ body_hash: "sha256:cancel", response: null, resource_id: stored.view.worldPrId, status: "in_progress" }] };
      if (sql === "SELECT read_model FROM tasks WHERE id = $1") return { rowCount: 1, rows: [{ read_model: stored.view }] };
      if (sql.includes("JOIN plans")) return { rowCount: 1, rows: [{ read_model: stored.view, payload: stored.planPayload }] };
      throw new Error(`Unexpected SQL in cancellation replay test: ${sql}`);
    });
    const store = new PostgresWorldPrStore({ query: poolQuery } as unknown as Pool);

    const replay = await store.cancel({
      actorId: "demo-operator",
      endpoint: `POST /api/v1/world-prs/${stored.view.worldPrId}/cancel`,
      idempotencyKey: "idempotency-key-cancel-1",
      bodyHash: "sha256:cancel",
      worldPrId: stored.view.worldPrId,
      requestId: "req_cancel_pending",
    });

    expect(replay.replay).toBe(true);
    expect(replay.response).toMatchObject({ worldPrId: stored.view.worldPrId, status: "preview_ready", replayPending: true });
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
