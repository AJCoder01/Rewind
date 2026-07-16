import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/session";
import { apiError } from "@/lib/api/errors";
import { createOpaqueId } from "@/lib/domain/ids";
import { ConnectionPreflightResponseSchema } from "@/lib/contracts/connection-preflight";
import { readConnectionPreflightStatus } from "@/lib/services/connection-preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = createOpaqueId("req_");
  const authorization = authorizeApiRequest(request, { mutation: false, allowMcp: false });
  if ("error" in authorization) {
    return apiError("unauthorized", "An authenticated dashboard session is required.", requestId, 401);
  }

  try {
    const snapshot = await readConnectionPreflightStatus();
    const response = NextResponse.json(ConnectionPreflightResponseSchema.parse({ ...snapshot, requestId }), {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
    response.headers.set("x-content-type-options", "nosniff");
    return response;
  } catch {
    return apiError("provider_unavailable", "Connection status is unavailable; no external action was attempted.", requestId, 503, true);
  }
}
