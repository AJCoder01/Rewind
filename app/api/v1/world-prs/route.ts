import { NextRequest, NextResponse } from "next/server";
import { apiError, statusForCode } from "@/lib/api/errors";
import { readDashboardActor, isSameOrigin, safeSecretEqual } from "@/lib/auth/session";
import { createWorldPr, ServiceError } from "@/lib/services/world-pr";
import { createOpaqueId } from "@/lib/domain/ids";

export const runtime = "nodejs";

function authenticatedActor(request: NextRequest): { actorId: string; source: "dashboard" | "mcp" } | null {
  const authorization = request.headers.get("authorization");
  const configuredMcpToken = process.env.MCP_BACKEND_TOKEN;
  if (authorization?.startsWith("Bearer ") && configuredMcpToken && safeSecretEqual(authorization.slice(7), configuredMcpToken)) return { actorId: "mcp:scoped-token", source: "mcp" };
  const actor = readDashboardActor(request);
  return actor && isSameOrigin(request) ? actor : null;
}

export async function POST(request: NextRequest) {
  const requestId = createOpaqueId("req_");
  const actor = authenticatedActor(request);
  if (!actor) return apiError("unauthorized", "An authenticated dashboard session or scoped MCP token is required.", requestId, 401);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) return apiError("invalid_request", "Idempotency-Key is required.", requestId, 422);
  const body: unknown = await request.json().catch(() => null);
  try {
    const result = await createWorldPr({ actorId: actor.actorId, source: actor.source, idempotencyKey, request: body, requestId });
    return NextResponse.json(result.response, { status: result.replay ? 200 : 201 });
  } catch (error) {
    if (error instanceof ServiceError) return apiError(error.code, error.message, requestId, statusForCode(error.code));
    if (error instanceof Error && error.name === "StorageNotConfiguredError") return apiError("provider_unavailable", "Persistent storage is not configured; no plan was created.", requestId, 503, true);
    return apiError("internal_error", "The request could not be recorded safely; no external action was attempted.", requestId, 500, true);
  }
}
