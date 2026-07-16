import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresOAuthStore } from "@/lib/db/oauth-store";

describe("PostgreSQL OAuth transaction store", () => {
  it("binds consumed_at to the timestamp parameter, not the redirect URI", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = new PostgresOAuthStore({ query } as unknown as Pool);
    const consumedAt = new Date("2026-07-16T01:02:03.000Z");

    await store.consumeTransaction({
      stateHash: "sha256:state",
      sessionHash: "sha256:session",
      redirectUri: "https://rewind.example.test/api/v1/oauth/google/callback",
      clientId: "123456789-rewind.apps.googleusercontent.com",
      consumedAt,
    });

    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("SET consumed_at = $5");
    expect(values[2]).toBe("https://rewind.example.test/api/v1/oauth/google/callback");
    expect(values[4]).toEqual(consumedAt);
  });
});
