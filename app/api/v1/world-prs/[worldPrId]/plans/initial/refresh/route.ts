import { NextRequest, NextResponse } from "next/server";
import { apiError, isRetryableErrorCode, statusForCode } from "@/lib/api/errors";
import { authorizeApiRequest, missingProductionAuthConfiguration } from "@/lib/auth/session";
import { createOpaqueId } from "@/lib/domain/ids";
import { replanInitialPlan } from "@/lib/services/initial-approval";
import { ServiceError, getWorldPr } from "@/lib/services/world-pr";
import { InitialPlanMutationRequestSchema } from "@/lib/contracts/initial-approval";
import { getWorldPrStore } from "@/lib/db";
import { isInitialPlanView } from "@/lib/contracts/v1";
import { loadLiveInitialExecutionRuntime } from "@/lib/services/live-initial-runtime";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ worldPrId: string }> }) {
  const requestId = createOpaqueId("req_");
  if (missingProductionAuthConfiguration().length > 0) return apiError("provider_unavailable", "Dashboard authentication is not configured; no plan refresh was recorded.", requestId, 503, true);
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
    const pointer = InitialPlanMutationRequestSchema.safeParse(body);
    if (!pointer.success) throw new ServiceError("invalid_request", "The request must identify the exact initial plan version and digest.");
    const current = await getWorldPr(worldPrId, authorization.actor.actorId);
    if (!current) throw new ServiceError("task_not_found", "That World PR does not exist in the current controlled workspace.");
    if (!current.activePlan || !isInitialPlanView(current.activePlan)) throw new ServiceError("plan_not_found", "That World PR does not have an active initial plan.");
    if (current.status !== "preview_ready") {
      throw new ServiceError("invalid_task_state", "Only an unapproved preview can be refreshed; no provider call was attempted.");
    }
    if (
      current.activePlan.pointer.planId !== pointer.data.planId ||
      current.activePlan.pointer.version !== pointer.data.planVersion ||
      current.activePlan.pointer.digest !== pointer.data.planDigest
    ) {
      throw new ServiceError("plan_digest_mismatch", "The requested plan is no longer the active immutable preview.");
    }
    const currentPayload = await getWorldPrStore().getInitialPlanPayload(worldPrId, pointer.data.planId);
    if (!currentPayload) throw new ServiceError("plan_not_found", "The requested immutable plan does not exist.");
    let nextPayload;
    try {
      const runtime = await loadLiveInitialExecutionRuntime(worldPrId);
      if (!runtime.buildReplacement) throw new Error("replacement planner unavailable");
      nextPayload = await runtime.buildReplacement(currentPayload);
    } catch (error) {
      throw new ServiceError("provider_unavailable", "A fresh provider-grounded preview could not be prepared; no external action was attempted.", { cause: error });
    }
    const result = await replanInitialPlan({
      actorId: authorization.actor.actorId,
      source: "dashboard",
      idempotencyKey,
      requestId,
      worldPrId,
      request: body,
      nextPayload,
    });
    return NextResponse.json(result.response, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceError) return apiError(error.code, error.message, requestId, statusForCode(error.code), isRetryableErrorCode(error.code));
    return apiError("internal_error", "The plan refresh could not be recorded safely; no external action was attempted.", requestId, 500, true);
  }
}
