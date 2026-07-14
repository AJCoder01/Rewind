import type { CreateWorldPrResponse, InitialPlanPayload, WorldPrView } from "@/lib/contracts/v1";

export interface CreateWorldPrStoreInput {
  actorId: string;
  endpoint: string;
  idempotencyKey: string;
  bodyHash: string;
  request: string;
  requestId: string;
  reviewUrl: string;
}

export type CreateWorldPrStoreResult = {
  view: WorldPrView;
  planPayload: InitialPlanPayload;
  response: CreateWorldPrResponse;
  replay: boolean;
};

export interface WorldPrStore {
  createInitial(input: CreateWorldPrStoreInput): Promise<CreateWorldPrStoreResult>;
  get(worldPrId: string): Promise<WorldPrView | null>;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Persistent storage is not configured for this environment.");
    this.name = "StorageNotConfiguredError";
  }
}
