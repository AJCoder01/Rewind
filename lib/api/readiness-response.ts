import { checkDatabaseReadiness, type DatabaseReadiness } from "@/lib/db/readiness";
import { createOpaqueId } from "@/lib/domain/ids";
import { apiError } from "@/lib/api/errors";
import { NextResponse } from "next/server";

type ReadinessCheck = () => Promise<DatabaseReadiness>;

export async function readinessResponse(check: ReadinessCheck = checkDatabaseReadiness) {
  const requestId = createOpaqueId("req_");
  try {
    const readiness = await check();
    if (!readiness.ready) {
      return unavailableResponse(requestId);
    }
    return NextResponse.json(
      { status: "ready", service: "rewind", schemaVersion: readiness.migrationId, requestId },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return unavailableResponse(requestId);
  }
}

function unavailableResponse(requestId: string): NextResponse {
  const response = apiError("provider_unavailable", "Rewind is not ready.", requestId, 503, true);
  response.headers.set("cache-control", "no-store");
  return response;
}
