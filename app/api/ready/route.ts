import { readinessResponse } from "@/lib/api/readiness-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return readinessResponse();
}
