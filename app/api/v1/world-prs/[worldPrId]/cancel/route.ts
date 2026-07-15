import { NextRequest, NextResponse } from "next/server";
import { apiError, statusForCode } from "@/lib/api/errors";
import { authorizeApiRequest, missingProductionAuthConfiguration } from "@/lib/auth/session";
import { createOpaqueId } from "@/lib/domain/ids";
import { cancelWorldPr, ServiceError } from "@/lib/services/world-pr";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ worldPrId: string }> }) {
  const requestId = createOpaqueId("req_");
  if (missingProductionAuthConfiguration().length > 0) return apiError("provider_unavailable", "Dashboard authentication is not configured; no cancellation was recorded.", requestId, 503, true);
  const authorization = authorizeApiRequest(request, { mutation: true, allowMcp: false });
  if ("error" in authorization) {
    return authorization.error === "forbidden"
      ? apiError("forbidden", "This mutation requires a same-origin request and a valid dashboard CSRF token.", requestId, 403)
      : apiError("unauthorized", "An authenticated dashboard session is required.", requestId, 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) return apiError("invalid_request", "Idempotency-Key is required.", requestId, 422);
  const body: unknown = await request.json().catch(() => null);
  const { worldPrId } = await context.params;
  try {
    const result = await cancelWorldPr({
      actorId: authorization.actor.actorId,
      source: "dashboard",
      idempotencyKey,
      worldPrId,
      request: body,
      requestId,
    });
    return NextResponse.json(result.response, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceError) return apiError(error.code, error.message, requestId, statusForCode(error.code));
    return apiError("internal_error", "The cancellation could not be recorded safely; no external action was attempted.", requestId, 500, true);
  }
}
