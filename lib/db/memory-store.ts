import { buildFixtureWorldPrRecord } from "@/lib/domain/fixture-world-pr";
import type { WorldPrView } from "@/lib/contracts/v1";
import { sha256Digest } from "@/lib/domain/digest";
import type { CreateWorldPrStoreInput, CreateWorldPrStoreResult, WorldPrStore } from "@/lib/db/store";

type IdempotencyRecord = {
  bodyHash: string;
  result: CreateWorldPrStoreResult;
};

export class MemoryFixtureWorldPrStore implements WorldPrStore {
  private readonly byWorldPrId = new Map<string, WorldPrView>();
  private readonly byIdempotency = new Map<string, IdempotencyRecord>();
  private scenarioLocked = false;

  async createInitial(input: CreateWorldPrStoreInput): Promise<CreateWorldPrStoreResult> {
    const idempotencyId = `${input.actorId}:${input.endpoint}:${input.idempotencyKey}`;
    const existing = this.byIdempotency.get(idempotencyId);
    if (existing) {
      if (existing.bodyHash !== input.bodyHash) {
        throw new Error("idempotency_conflict");
      }
      return { ...existing.result, replay: true, response: { ...existing.result.response, replayPending: true } };
    }
    if (this.scenarioLocked) throw new Error("scenario_busy");
    this.scenarioLocked = true;
    const { view, planPayload } = buildFixtureWorldPrRecord(input.request);
    const response = { worldPrId: view.worldPrId, status: "preview_ready" as const, reviewUrl: input.reviewUrl.replace("{worldPrId}", view.worldPrId), requestId: input.requestId };
    const result = { view, planPayload, response, replay: false } satisfies CreateWorldPrStoreResult;
    this.byWorldPrId.set(view.worldPrId, view);
    this.byIdempotency.set(idempotencyId, { bodyHash: input.bodyHash, result });
    return result;
  }

  async get(worldPrId: string): Promise<WorldPrView | null> {
    return this.byWorldPrId.get(worldPrId) ?? null;
  }

  clear(): void {
    this.byWorldPrId.clear();
    this.byIdempotency.clear();
    this.scenarioLocked = false;
  }
}

type RewindGlobal = typeof globalThis & { __rewindMemoryFixtureStore?: MemoryFixtureWorldPrStore };
const rewindGlobal = globalThis as RewindGlobal;
export const memoryFixtureStore = rewindGlobal.__rewindMemoryFixtureStore ??= new MemoryFixtureWorldPrStore();

export function requestBodyHash(request: string): string {
  return sha256Digest({ request });
}
