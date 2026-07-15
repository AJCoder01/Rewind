import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/errors";
import { authorizeApiRequest, missingProductionAuthConfiguration } from "@/lib/auth/session";
import { createOpaqueId } from "@/lib/domain/ids";
import { getWorldPrStatus, ServiceError } from "@/lib/services/world-pr";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ worldPrId: string }> }) {
  const requestId = createOpaqueId("req_");
  if (missingProductionAuthConfiguration().length > 0) return apiError("provider_unavailable", "Dashboard authentication is not configured; no status was returned.", requestId, 503, true);
  const authorization = authorizeApiRequest(request, { mutation: false, allowMcp: true });
  if ("error" in authorization) return apiError("unauthorized", "An authenticated dashboard session or scoped MCP token is required.", requestId, 401);
  const { worldPrId } = await context.params;
  try {
    const status = await getWorldPrStatus(worldPrId, authorization.actor.actorId);
    if (!status) return apiError("task_not_found", "That World PR does not exist in the current controlled workspace.", requestId, 404);
    return NextResponse.json(status, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceError) return apiError(error.code, error.message, requestId, error.code === "forbidden" ? 403 : error.code === "task_not_found" ? 404 : 500, error.code === "provider_unavailable" || error.code === "internal_error");
    return apiError("internal_error", "The World PR status could not be loaded safely.", requestId, 500, true);
  }
}
