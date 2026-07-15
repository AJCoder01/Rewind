import { NextResponse } from "next/server";
import { createOpaqueId } from "@/lib/domain/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: "rewind", requestId: createOpaqueId("req_") },
    { headers: { "cache-control": "no-store" } },
  );
}
