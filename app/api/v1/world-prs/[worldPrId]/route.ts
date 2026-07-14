import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api/errors";
import { readDashboardActor } from "@/lib/auth/session";
import { createOpaqueId } from "@/lib/domain/ids";
import { getWorldPr } from "@/lib/services/world-pr";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ worldPrId: string }> }) {
  const requestId = createOpaqueId("req_");
  if (!readDashboardActor(request)) return apiError("unauthorized", "An authenticated dashboard session is required.", requestId, 401);
  const { worldPrId } = await context.params;
  try {
    const view = await getWorldPr(worldPrId);
    if (!view) return apiError("task_not_found", "That World PR does not exist in the current controlled workspace.", requestId, 404);
    return NextResponse.json(view, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === "StorageNotConfiguredError") {
      return apiError("provider_unavailable", "Persistent storage is not configured; no World PR can be loaded.", requestId, 503, true);
    }
    return apiError("internal_error", "The World PR could not be loaded safely.", requestId, 500, true);
  }
}
