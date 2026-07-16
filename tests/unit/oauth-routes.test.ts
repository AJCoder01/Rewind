import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as startGoogleOAuth } from "@/app/api/v1/oauth/google/start/route";
import { GET as callbackGoogleOAuth } from "@/app/api/v1/oauth/google/callback/route";
import { createSessionValue, sessionCookieName } from "@/lib/auth/session";
import { memoryOAuthStore } from "@/lib/db/index";
import { decryptOAuthSecret, encryptOAuthSecret, GOOGLE_OAUTH_SCOPES, GOOGLE_OAUTH_TOKEN_ENDPOINT } from "@/lib/google/oauth";
import { GOOGLE_OIDC_JWKS_URI } from "@/lib/google/oidc";

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
  "REWIND_GOOGLE_EXPECTED_EMAIL",
  "REWIND_GOOGLE_EXPECTED_SUB",
] as const;

const mutableEnvironment = process.env as Record<string, string | undefined>;
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
const clientId = "123456789-rewind.apps.googleusercontent.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const exportedJwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };

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
  process.env.REWIND_GOOGLE_EXPECTED_EMAIL = "rewind-demo@example.test";
  process.env.REWIND_GOOGLE_EXPECTED_SUB = "google-subject";
}

function request(path: string, session: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: `${sessionCookieName()}=${session}` },
  });
}

afterEach(() => {
  memoryOAuthStore.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete mutableEnvironment[key];
    else mutableEnvironment[key] = value;
  }
});

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function makeIdToken(nonce: string, overrides: Record<string, unknown> = {}): string {
  const header = base64UrlJson({ alg: "RS256", kid: "route-test-key", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlJson({
    iss: "https://accounts.google.com",
    sub: "google-subject",
    aud: clientId,
    exp: now + 3600,
    iat: now,
    nonce,
    email: "rewind-demo@example.test",
    email_verified: true,
    ...overrides,
  });
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput, "ascii");
  signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString("base64url")}`;
}

function stubGoogleTokenExchange(idToken: string, calls: string[]): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url === GOOGLE_OAUTH_TOKEN_ENDPOINT) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_id")).toBe(clientId);
      return new Response(
        JSON.stringify({
          access_token: "fake-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "fake-refresh-token",
          refresh_token_expires_in: 604800,
          id_token: idToken,
          scope: `${GOOGLE_OAUTH_SCOPES.join(" ")} https://www.googleapis.com/auth/userinfo.email`,
          future_google_metadata: "ignored-by-projection",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === GOOGLE_OIDC_JWKS_URI) {
      return new Response(
        JSON.stringify({
          keys: [{ kty: "RSA", kid: "route-test-key", n: exportedJwk.n, e: exportedJwk.e, alg: "RS256", use: "sig" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected provider URL: ${url}`);
  });
}

describe("Google OAuth routes", () => {
  it("requires an authenticated dashboard session before starting", async () => {
    setOAuthEnvironment();
    const response = await startGoogleOAuth(new NextRequest("http://localhost:3000/api/v1/oauth/google/start"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });

  it("starts an exact redirect and consumes the callback transaction only once", async () => {
    setOAuthEnvironment();
    vi.stubGlobal("fetch", async () => {
      throw new Error("deterministic provider outage");
    });
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
      error: { code: "provider_unavailable", retryable: true },
    });

    const replay = await callbackGoogleOAuth(request(callbackPath, session));
    expect(replay.status).toBe(422);
    await expect(replay.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("rejects missing and mismatched state before contacting a provider", async () => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("provider must not be called");
    });

    const missingState = await callbackGoogleOAuth(request("/api/v1/oauth/google/callback?code=fake-code", session));
    expect(missingState.status).toBe(422);
    const mismatchedState = await callbackGoogleOAuth(
      request("/api/v1/oauth/google/callback?state=not-the-started-state&code=fake-code", session),
    );
    expect(mismatchedState.status).toBe(422);
    expect(calls).toEqual([]);
    await expect(memoryOAuthStore.getCredential()).resolves.toBeNull();
  });

  it.each([
    ["nonce mismatch", { nonce: "wrong-nonce" }],
    ["wrong issuer", { iss: "https://attacker.example.test" }],
    ["wrong audience", { aud: "other-client.apps.googleusercontent.com" }],
    ["expired token", { exp: Math.floor(Date.now() / 1000) - 301 }],
    ["unverified email", { email_verified: false }],
    ["wrong stable subject", { sub: "other-subject" }],
    ["wrong account email", { email: "other@example.test" }],
  ])("fails closed for callback claim failure: %s", async (_label, overrides) => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const started = await startGoogleOAuth(request("/api/v1/oauth/google/start", session));
    const location = new URL(started.headers.get("location")!);
    stubGoogleTokenExchange(makeIdToken(location.searchParams.get("nonce")!, overrides), []);

    const callbackPath = `/api/v1/oauth/google/callback?state=${encodeURIComponent(location.searchParams.get("state")!)}&code=fake-code&scope=${encodeURIComponent(GOOGLE_OAUTH_SCOPES.join(" "))}&authuser=0&hd=example.test&prompt=consent&iss=https%3A%2F%2Faccounts.google.com`;
    const response = await callbackGoogleOAuth(request(callbackPath, session));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden", retryable: false } });
    await expect(memoryOAuthStore.getCredential()).resolves.toBeNull();
  });

  it("fails closed for a malformed ID token without saving a credential", async () => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const started = await startGoogleOAuth(request("/api/v1/oauth/google/start", session));
    const location = new URL(started.headers.get("location")!);
    stubGoogleTokenExchange("not-a-jwt", []);

    const callbackPath = `/api/v1/oauth/google/callback?state=${encodeURIComponent(location.searchParams.get("state")!)}&code=fake-code`;
    const response = await callbackGoogleOAuth(request(callbackPath, session));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden", retryable: false } });
    await expect(memoryOAuthStore.getCredential()).resolves.toBeNull();
  });

  it("does not connect when the provider rejects a mismatched PKCE verifier", async () => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const started = await startGoogleOAuth(request("/api/v1/oauth/google/start", session));
    const location = new URL(started.headers.get("location")!);
    const originalConsume = memoryOAuthStore.consumeTransaction.bind(memoryOAuthStore);
    vi.spyOn(memoryOAuthStore, "consumeTransaction").mockImplementation(async (input) => {
      const transaction = await originalConsume(input);
      return transaction
        ? {
            ...transaction,
            codeVerifierCiphertext: encryptOAuthSecret(
              "mismatched-pkce-verifier",
              process.env.REWIND_TOKEN_ENCRYPTION_KEY!,
            ),
          }
        : null;
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(GOOGLE_OAUTH_TOKEN_ENDPOINT);
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("code_verifier")).toBe("mismatched-pkce-verifier");
      return new Response(JSON.stringify({ error: "invalid_grant", error_description: "sensitive provider detail" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    });

    const callbackPath = `/api/v1/oauth/google/callback?state=${encodeURIComponent(location.searchParams.get("state")!)}&code=fake-code`;
    const response = await callbackGoogleOAuth(request(callbackPath, session));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "provider_unavailable",
        retryable: true,
        details: { failureStage: "token_exchange", failureReason: "grant_rejected" },
      },
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive provider detail");
    await expect(memoryOAuthStore.getCredential()).resolves.toBeNull();
  });

  it("persists an encrypted credential only after signed identity and scope checks", async () => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const started = await startGoogleOAuth(request("/api/v1/oauth/google/start", session));
    const location = new URL(started.headers.get("location")!);
    const calls: string[] = [];
    stubGoogleTokenExchange(makeIdToken(location.searchParams.get("nonce")!), calls);

    const callbackPath = `/api/v1/oauth/google/callback?state=${encodeURIComponent(location.searchParams.get("state")!)}&code=fake-code&scope=${encodeURIComponent(GOOGLE_OAUTH_SCOPES.join(" "))}&authuser=0&hd=example.test&prompt=consent&iss=https%3A%2F%2Faccounts.google.com`;
    const response = await callbackGoogleOAuth(request(callbackPath, session));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "connected", provider: "google" });
    const credential = await memoryOAuthStore.getCredential();
    expect(credential?.googleSub).toBe("google-subject");
    expect(credential?.email).toBe("rewind-demo@example.test");
    expect(credential?.refreshTokenCiphertext).not.toContain("fake-refresh-token");
    expect(decryptOAuthSecret(credential!.refreshTokenCiphertext, process.env.REWIND_TOKEN_ENCRYPTION_KEY!)).toBe("fake-refresh-token");
    expect(calls).toEqual([GOOGLE_OAUTH_TOKEN_ENDPOINT, GOOGLE_OIDC_JWKS_URI]);
    expect(calls.some((url) => url.includes("gmail"))).toBe(false);
  });

  it("rejects account substitution without saving a credential", async () => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const started = await startGoogleOAuth(request("/api/v1/oauth/google/start", session));
    const location = new URL(started.headers.get("location")!);
    stubGoogleTokenExchange(makeIdToken(location.searchParams.get("nonce")!, { sub: "other-subject" }), []);

    const callbackPath = `/api/v1/oauth/google/callback?state=${encodeURIComponent(location.searchParams.get("state")!)}&code=fake-code`;
    const response = await callbackGoogleOAuth(request(callbackPath, session));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden", retryable: false } });
    await expect(memoryOAuthStore.getCredential()).resolves.toBeNull();
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

  it("ignores bounded unknown callback metadata while still consuming state exactly once", async () => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const started = await startGoogleOAuth(request("/api/v1/oauth/google/start", session));
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
    vi.stubGlobal("fetch", async () => {
      throw new Error("deterministic provider outage");
    });
    const response = await callbackGoogleOAuth(
      request(`/api/v1/oauth/google/callback?state=${encodeURIComponent(state)}&code=fake-code&future_google_metadata=ignored`, session),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { details: { failureStage: "token_exchange", failureReason: "endpoint_unreachable" } },
    });

    const replay = await callbackGoogleOAuth(
      request(`/api/v1/oauth/google/callback?state=${encodeURIComponent(state)}&code=fake-code`, session),
    );
    expect(replay.status).toBe(422);
  });

  it("rejects an oversized unknown callback parameter before transaction lookup", async () => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const consume = vi.spyOn(memoryOAuthStore, "consumeTransaction");
    const response = await callbackGoogleOAuth(
      request(`/api/v1/oauth/google/callback?state=one&code=fake-code&future=${"x".repeat(8193)}`, session),
    );
    expect(response.status).toBe(422);
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects a partial front-channel scope grant before token exchange", async () => {
    setOAuthEnvironment();
    const session = createSessionValue("demo-operator");
    const started = await startGoogleOAuth(request("/api/v1/oauth/google/start", session));
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const provider = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", provider);
    const response = await callbackGoogleOAuth(
      request(`/api/v1/oauth/google/callback?state=${encodeURIComponent(state)}&code=fake-code&scope=openid%20email`, session),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "forbidden",
        retryable: false,
        details: { failureStage: "callback_scope", failureReason: "scope_outside_approved_set" },
      },
    });
    expect(provider).not.toHaveBeenCalled();
    await expect(memoryOAuthStore.getCredential()).resolves.toBeNull();
  });
});
