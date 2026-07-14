import { CreateWorldPrRequestSchema, type CreateWorldPrResponse, type WorldPrView } from "@/lib/contracts/v1";
import { createOpaqueId } from "@/lib/domain/ids";
import { isSupportedScenarioRequest } from "@/lib/domain/scenario";
import { getWorldPrStore } from "@/lib/db";
import { requestBodyHash } from "@/lib/db/memory-store";

export type CreateWorldPrInput = {
  actorId: string;
  source: "dashboard" | "mcp";
  idempotencyKey: string;
  requestId?: string;
  request: unknown;
};

export class ServiceError extends Error {
  constructor(public readonly code: "invalid_request" | "unsupported_request" | "idempotency_conflict" | "scenario_busy" | "task_not_found", message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export async function createWorldPr(input: CreateWorldPrInput): Promise<{ response: CreateWorldPrResponse; view: WorldPrView; replay: boolean }> {
  const parsed = CreateWorldPrRequestSchema.safeParse(input.request);
  if (!parsed.success) throw new ServiceError("invalid_request", "Request must contain one supported task description.");
  if (!isSupportedScenarioRequest(parsed.data.request)) throw new ServiceError("unsupported_request", "This demo supports only the controlled Acme Calendar, mail, and account-brief scenario.");
  if (!input.idempotencyKey || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) throw new ServiceError("invalid_request", "Idempotency-Key is required and must be between 16 and 200 characters.");
  const requestId = input.requestId ?? createOpaqueId("req_");
  const store = getWorldPrStore();
  try {
    const result = await store.createInitial({
      actorId: input.actorId,
      endpoint: "POST /api/v1/world-prs",
      idempotencyKey: input.idempotencyKey,
      bodyHash: requestBodyHash(parsed.data.request),
      request: parsed.data.request,
      requestId,
      reviewUrl: `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/pr/{worldPrId}`,
    });
    return result;
  } catch (error) {
    if (error instanceof Error && (error.message === "idempotency_conflict" || error.message === "scenario_busy")) {
      throw new ServiceError(error.message, error.message === "scenario_busy" ? "The controlled demo scenario is already in use." : "This idempotency key was already used for a different request.");
    }
    throw error;
  }
}

export async function getWorldPr(worldPrId: string): Promise<WorldPrView | null> {
  return getWorldPrStore().get(worldPrId);
}
