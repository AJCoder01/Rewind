import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isSameOrigin, safeSecretEqual } from "@/lib/auth/session";

const originalBaseUrl = process.env.APP_BASE_URL;

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalBaseUrl;
});

describe("dashboard and MCP request authentication helpers", () => {
  it("compares secrets without direct string equality", () => {
    expect(safeSecretEqual("scoped-secret", "scoped-secret")).toBe(true);
    expect(safeSecretEqual("wrong", "scoped-secret")).toBe(false);
  });

  it("uses the configured public app origin for same-origin checks", () => {
    process.env.APP_BASE_URL = "http://127.0.0.1:3100";
    const accepted = new NextRequest("http://localhost:3100/api/v1/auth/session", {
      headers: { origin: "http://127.0.0.1:3100" },
    });
    const rejected = new NextRequest("http://localhost:3100/api/v1/auth/session", {
      headers: { origin: "https://example.invalid" },
    });
    expect(isSameOrigin(accepted)).toBe(true);
    expect(isSameOrigin(rejected)).toBe(false);
  });
});
