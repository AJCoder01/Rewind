import { NextRequest, NextResponse } from "next/server";
import { apiError, isRetryableErrorCode, statusForCode } from "@/lib/api/errors";
import { authorizeApiRequest, missingProductionAuthConfiguration } from "@/lib/auth/session";
import { createOpaqueId } from "@/lib/domain/ids";
import { getExecutionTimeline } from "@/lib/services/execution-timeline";
import { executeApprovedInitialWorkflow } from "@/lib/services/initial-workflow-execution";
import { ServiceError } from "@/lib/services/world-pr";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ worldPrId: string }> }) {
  const requestId = createOpaqueId("req_");
  if (missingProductionAuthConfiguration().length > 0) return apiError("provider_unavailable", "Dashboard authentication is not configured; no execution state was returned.", requestId, 503, true);
  const authorization = authorizeApiRequest(request, { mutation: false, allowMcp: false });
  if ("error" in authorization) return apiError("unauthorized", "An authenticated dashboard session is required to view execution receipts.", requestId, 401);
  const { worldPrId } = await context.params;
  try {
    const timeline = await getExecutionTimeline(worldPrId, authorization.actor.actorId);
    if (!timeline) return apiError("task_not_found", "That World PR does not exist in the current controlled workspace.", requestId, 404);
    return NextResponse.json(timeline, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceError) return apiError(error.code, error.message, requestId, statusForCode(error.code), isRetryableErrorCode(error.code));
    return apiError("internal_error", "The execution state could not be loaded safely.", requestId, 500, true);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ worldPrId: string }> }) {
  const requestId = createOpaqueId("req_");
  if (missingProductionAuthConfiguration().length > 0) {
    return apiError("provider_unavailable", "Dashboard authentication is not configured; no execution was attempted.", requestId, 503, true);
  }
  const authorization = authorizeApiRequest(request, { mutation: true, allowMcp: false });
  if ("error" in authorization) {
    return authorization.error === "forbidden"
      ? apiError("forbidden", "Execution requires a same-origin request and a valid dashboard CSRF token.", requestId, 403)
      : apiError("unauthorized", "An authenticated dashboard session is required to execute an approved plan.", requestId, 401);
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) return apiError("invalid_request", "Idempotency-Key is required.", requestId, 422);
  const body: unknown = await request.json().catch(() => null);
  const { worldPrId } = await context.params;
  try {
    const result = await executeApprovedInitialWorkflow({
      actorId: authorization.actor.actorId,
      source: "dashboard",
      idempotencyKey,
      requestId,
      worldPrId,
      request: body,
    });
    return NextResponse.json(result.response, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceError) return apiError(error.code, error.message, requestId, statusForCode(error.code), isRetryableErrorCode(error.code));
    return apiError("internal_error", "Initial execution failed safely; review durable state before retrying.", requestId, 500, true);
  }
}
