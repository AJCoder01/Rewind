import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("reports process liveness without caching or dependency details", async () => {
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ status: "ok", service: "rewind" });
    expect(body.requestId).toMatch(/^req_[A-Za-z0-9_-]+$/);
    expect(body).not.toHaveProperty("database");
    expect(body).not.toHaveProperty("schemaVersion");
  });
});
