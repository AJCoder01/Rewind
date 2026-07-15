import { describe, expect, it } from "vitest";
import { readinessResponse } from "@/lib/api/readiness-response";
import { ApiErrorResponseSchema } from "@/lib/contracts/v1";
import { OAUTH_MIGRATION_ID } from "@/lib/db/schema";

describe("GET /api/ready", () => {
  it("returns a non-cacheable ready response without database details", async () => {
    const response = await readinessResponse(async () => ({ ready: true, migrationId: OAUTH_MIGRATION_ID }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      service: "rewind",
      schemaVersion: OAUTH_MIGRATION_ID,
    });
  });

  it("returns a sanitized 503 for a failed invariant", async () => {
    const response = await readinessResponse(async () => ({ ready: false, migrationId: OAUTH_MIGRATION_ID }));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(ApiErrorResponseSchema.parse(body)).toMatchObject({
      error: { code: "provider_unavailable", message: "Rewind is not ready.", retryable: true },
    });
    expect(body).not.toHaveProperty("database");
  });

  it("returns the same sanitized 503 when the database query throws", async () => {
    const response = await readinessResponse(async () => {
      throw new Error("sensitive provider detail");
    });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(ApiErrorResponseSchema.safeParse(body).success).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sensitive provider detail");
  });
});
