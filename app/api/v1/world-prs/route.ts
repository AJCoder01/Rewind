import { NextRequest, NextResponse } from "next/server";
import { apiError, statusForCode } from "@/lib/api/errors";
import { authorizeApiRequest, missingProductionAuthConfiguration } from "@/lib/auth/session";
import { createWorldPr, ServiceError } from "@/lib/services/world-pr";
import { createOpaqueId } from "@/lib/domain/ids";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = createOpaqueId("req_");
  if (missingProductionAuthConfiguration().length > 0) {
    return apiError("provider_unavailable", "Dashboard authentication is not configured; no plan was created.", requestId, 503, true);
  }
  const authorization = authorizeApiRequest(request, { mutation: true, allowMcp: true });
  if ("error" in authorization) {
    return authorization.error === "forbidden"
      ? apiError("forbidden", "This mutation requires a same-origin request and a valid dashboard CSRF token.", requestId, 403)
      : apiError("unauthorized", "An authenticated dashboard session or scoped MCP token is required.", requestId, 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) return apiError("invalid_request", "Idempotency-Key is required.", requestId, 422);
  const body: unknown = await request.json().catch(() => null);
  try {
    const result = await createWorldPr({ actorId: authorization.actor.actorId, source: authorization.actor.source, idempotencyKey, request: body, requestId });
    return NextResponse.json(result.response, { status: result.replay ? 200 : 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceError) return apiError(error.code, error.message, requestId, statusForCode(error.code));
    if (error instanceof Error && error.name === "StorageNotConfiguredError") return apiError("provider_unavailable", "Persistent storage is not configured; no plan was created.", requestId, 503, true);
    return apiError("internal_error", "The request could not be recorded safely; no external action was attempted.", requestId, 500, true);
  }
}
