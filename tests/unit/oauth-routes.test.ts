import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as startGoogleOAuth } from "@/app/api/v1/oauth/google/start/route";
import { GET as callbackGoogleOAuth } from "@/app/api/v1/oauth/google/callback/route";
import { createSessionValue, sessionCookieName } from "@/lib/auth/session";
import { memoryOAuthStore } from "@/lib/db/index";

const environmentKeys = [
  "NODE_ENV",
  "APP_BASE_URL",
  "REWIND_SESSION_SECRET",
  "REWIND_STORAGE_MODE",
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "REWIND_TOKEN_ENCRYPTION_KEY",
] as const;

const mutableEnvironment = process.env as Record<string, string | undefined>;
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

function setOAuthEnvironment(): void {
  mutableEnvironment.NODE_ENV = "test";
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.REWIND_SESSION_SECRET = "unit-session-secret-that-is-long-enough-for-tests";
  process.env.REWIND_STORAGE_MODE = "memory_fixture";
  delete process.env.DATABASE_URL;
  process.env.GOOGLE_CLIENT_ID = "123456789-rewind.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "fake-google-client-secret-that-is-never-live";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/v1/oauth/google/callback";
  process.env.REWIND_TOKEN_ENCRYPTION_KEY = "fake-token-encryption-key-that-is-long-enough";
}

function request(path: string, session: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: `${sessionCookieName()}=${session}` },
  });
}

afterEach(() => {
  memoryOAuthStore.clear();
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete mutableEnvironment[key];
    else mutableEnvironment[key] = value;
  }
});

describe("Google OAuth routes", () => {
  it("requires an authenticated dashboard session before starting", async () => {
    setOAuthEnvironment();
    const response = await startGoogleOAuth(new NextRequest("http://localhost:3000/api/v1/oauth/google/start"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });

  it("starts an exact redirect and consumes the callback transaction only once", async () => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const started = await startGoogleOAuth(request("/api/v1/oauth/google/start", session));
    expect(started.status).toBe(307);
    expect(started.headers.get("cache-control")).toBe("no-store");
    const location = new URL(started.headers.get("location")!);
    const state = location.searchParams.get("state");
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("redirect_uri")).toBe(process.env.GOOGLE_REDIRECT_URI);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(state).toBeTruthy();

    const callbackPath = `/api/v1/oauth/google/callback?state=${encodeURIComponent(state!)}&code=fake-code`;
    const firstCallback = await callbackGoogleOAuth(request(callbackPath, session));
    expect(firstCallback.status).toBe(503);
    await expect(firstCallback.json()).resolves.toMatchObject({
      error: { code: "provider_unavailable", retryable: false },
    });

    const replay = await callbackGoogleOAuth(request(callbackPath, session));
    expect(replay.status).toBe(422);
    await expect(replay.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("does not consume a transaction from a different browser session", async () => {
    setOAuthEnvironment();
    const initiatingSession = createSessionValue("demo-operator");
    const otherSession = createSessionValue("other-operator");
    const started = await startGoogleOAuth(request("/api/v1/oauth/google/start", initiatingSession));
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const callbackPath = `/api/v1/oauth/google/callback?state=${encodeURIComponent(state)}&code=fake-code`;

    const wrongSession = await callbackGoogleOAuth(request(callbackPath, otherSession));
    expect(wrongSession.status).toBe(422);
    const correctSession = await callbackGoogleOAuth(request(callbackPath, initiatingSession));
    expect(correctSession.status).toBe(503);
  });

  it("rejects duplicate callback parameters before looking up a transaction", async () => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const response = await callbackGoogleOAuth(
      request("/api/v1/oauth/google/callback?state=one&state=two&code=fake-code", session),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });
});
