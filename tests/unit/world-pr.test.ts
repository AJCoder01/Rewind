import { beforeEach, describe, expect, it } from "vitest";
import { memoryFixtureStore } from "@/lib/db/memory-store";
import { sha256Digest, sha256Text } from "@/lib/domain/digest";
import { buildFixtureWorldPrRecord } from "@/lib/domain/fixture-world-pr";
import { SUPPORTED_SCENARIO_REQUEST } from "@/lib/domain/scenario";
import { createWorldPr } from "@/lib/services/world-pr";

const request = SUPPORTED_SCENARIO_REQUEST;

describe("fixture-backed World PR service", () => {
  beforeEach(() => {
    process.env.REWIND_STORAGE_MODE = "memory_fixture";
    memoryFixtureStore.clear();
  });

  it("creates a complete preview and replays identical idempotency keys", async () => {
    const first = await createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idempotency-key-0001", request: { request } });
    const replay = await createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idempotency-key-0001", request: { request } });
    expect(first.response.worldPrId).toBe(replay.response.worldPrId);
    expect(replay.replay).toBe(true);
    expect(first.view.activePlan?.actions).toHaveLength(3);
    expect(first.view.activePlan?.pointer.digest).toMatch(/^sha256:/);
  });

  it("rejects reuse of an idempotency key for a different body", async () => {
    await createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idempotency-key-0001", request: { request } });
    await expect(createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idempotency-key-0001", request: { request: request.toUpperCase() } })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("rejects unsupported scenario requests", async () => {
    await expect(createWorldPr({ actorId: "test:operator", source: "dashboard", idempotencyKey: "idempotency-key-0002", request: { request: "Email an Acme renewal risk brief, but do not move the controlled meeting." } })).rejects.toMatchObject({ code: "unsupported_request" });
  });

  it("persists a reproducible full plan digest and hashes text bytes exactly", () => {
    const { planPayload } = buildFixtureWorldPrRecord(request, new Date("2026-07-14T00:00:00.000Z"));
    const { digest, ...core } = planPayload;
    expect(sha256Digest(core)).toBe(digest);
    expect(sha256Text("abc")).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
