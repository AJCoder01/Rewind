import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  encryptedGoogleCredential,
  parseGrantedGoogleScopes,
  refreshGoogleAccessToken,
} from "@/lib/google/credentials";
import {
  buildGoogleAuthorizationUrl,
  buildGoogleTokenExchangeBody,
  codeChallengeS256,
  createGoogleOAuthTransaction,
  decryptOAuthSecret,
  encryptOAuthSecret,
  GOOGLE_OAUTH_SCOPES,
  hashOAuthSecret,
  recoverCodeVerifier,
  type GoogleOAuthConfiguration,
  toStoredGoogleOAuthTransaction,
} from "@/lib/google/oauth";
import { MemoryOAuthStore } from "@/lib/db/oauth-store";

const configuration: GoogleOAuthConfiguration = {
  appBaseUrl: "https://rewind.example.test",
  redirectUri: "https://rewind.example.test/api/v1/oauth/google/callback",
  clientId: "123456789-rewind.apps.googleusercontent.com",
  clientSecret: "fake-google-client-secret-that-is-never-live",
  tokenEncryptionKey: "fake-token-encryption-key-that-is-long-enough",
  expectedEmail: "rewind-demo@example.test",
  expectedSub: "google-subject",
};

describe("Google OAuth transaction boundary", () => {
  it("creates high-entropy state, nonce, and PKCE S256 authorization parameters", () => {
    const transaction = createGoogleOAuthTransaction(configuration, new Date("2026-07-16T00:00:00.000Z"));
    const url = buildGoogleAuthorizationUrl(configuration, transaction);
    expect(transaction.state).toHaveLength(43);
    expect(transaction.nonce).toHaveLength(43);
    expect(transaction.codeVerifier).toHaveLength(43);
    expect(transaction.codeChallenge).toBe(codeChallengeS256(transaction.codeVerifier));
    expect(transaction.expiresAt.toISOString()).toBe("2026-07-16T00:10:00.000Z");
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(configuration.redirectUri);
    expect(url.searchParams.get("state")).toBe(transaction.state);
    expect(url.searchParams.get("nonce")).toBe(transaction.nonce);
    expect(url.searchParams.get("code_challenge")).toBe(transaction.codeChallenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/calendar.events.owned https://www.googleapis.com/auth/gmail.send",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("stores only hashed transaction values and encrypted verifier material", () => {
    const transaction = createGoogleOAuthTransaction(configuration, new Date("2026-07-16T00:00:00.000Z"));
    const stored = toStoredGoogleOAuthTransaction(transaction, hashOAuthSecret("browser-session"), configuration.tokenEncryptionKey);
    expect(stored.stateHash).toBe(hashOAuthSecret(transaction.state));
    expect(stored.nonceHash).toBe(hashOAuthSecret(transaction.nonce));
    expect(stored.stateHash).not.toContain(transaction.state);
    expect(stored.nonceHash).not.toContain(transaction.nonce);
    expect(stored.codeVerifierCiphertext).not.toContain(transaction.codeVerifier);
    expect(recoverCodeVerifier(stored, configuration.tokenEncryptionKey)).toBe(transaction.codeVerifier);
  });

  it("rejects tampered or wrongly keyed AES-GCM envelopes", () => {
    const ciphertext = encryptOAuthSecret("refresh-token-value", configuration.tokenEncryptionKey);
    const parts = ciphertext.split(".");
    parts[3] = `${parts[3]}x`;
    expect(() => decryptOAuthSecret(parts.join("."), configuration.tokenEncryptionKey)).toThrow();
    expect(() => decryptOAuthSecret(ciphertext, "another-key-that-is-long-enough-to-test")).toThrow();
  });

  it("builds an exact authorization-code exchange body with PKCE verifier", () => {
    const transaction = createGoogleOAuthTransaction(configuration);
    const body = buildGoogleTokenExchangeBody(configuration, transaction, "fake-authorization-code");
    expect(Object.fromEntries(body.entries())).toEqual({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      code: "fake-authorization-code",
      code_verifier: transaction.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: configuration.redirectUri,
    });
  });

  it("rejects missing PKCE verifier and redirect drift before token exchange", () => {
    const transaction = createGoogleOAuthTransaction(configuration);
    expect(() => buildGoogleTokenExchangeBody(configuration, { ...transaction, codeVerifier: "" }, "fake-code")).toThrow();
    expect(() =>
      buildGoogleTokenExchangeBody(
        configuration,
        { ...transaction, redirectUri: "https://attacker.example.test/oauth/callback" },
        "fake-code",
      ),
    ).toThrow();
  });

  it("consumes a session-bound transaction atomically once and keeps mismatches untouched", async () => {
    const store = new MemoryOAuthStore();
    const transaction = createGoogleOAuthTransaction(configuration, new Date("2026-07-16T00:00:00.000Z"));
    const stored = toStoredGoogleOAuthTransaction(transaction, hashOAuthSecret("browser-session"), configuration.tokenEncryptionKey);
    await store.createTransaction(stored);

    await expect(
      store.consumeTransaction({
        stateHash: stored.stateHash,
        sessionHash: hashOAuthSecret("different-session"),
        redirectUri: stored.redirectUri,
        clientId: stored.clientId,
      }),
    ).resolves.toBeNull();
    const first = await store.consumeTransaction({
      stateHash: stored.stateHash,
      sessionHash: stored.sessionHash,
      redirectUri: stored.redirectUri,
      clientId: stored.clientId,
      consumedAt: new Date("2026-07-16T00:01:00.000Z"),
    });
    expect(first?.consumedAt?.toISOString()).toBe("2026-07-16T00:01:00.000Z");
    await expect(store.consumeTransaction({
      stateHash: stored.stateHash,
      sessionHash: stored.sessionHash,
      redirectUri: stored.redirectUri,
      clientId: stored.clientId,
    })).resolves.toBeNull();
  });

  it("encrypts refresh-token persistence only after a validated identity is supplied", async () => {
    const store = new MemoryOAuthStore();
    const credential = encryptedGoogleCredential(
      { googleSub: "google-subject", email: "rewind-demo@example.test", scopes: [...GOOGLE_OAUTH_SCOPES] },
      {
        access_token: "fake-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "fake-refresh-token",
      },
      configuration.tokenEncryptionKey,
    );
    await store.saveCredential(credential);
    const stored = await store.getCredential();
    expect(stored?.refreshTokenCiphertext).toBeDefined();
    expect(stored?.refreshTokenCiphertext).not.toContain("fake-refresh-token");
    expect(decryptOAuthSecret(stored!.refreshTokenCiphertext, configuration.tokenEncryptionKey)).toBe("fake-refresh-token");
    expect(stored?.email).toBe("rewind-demo@example.test");
  });

  it("accepts only the exact approved scope set", () => {
    expect(parseGrantedGoogleScopes(GOOGLE_OAUTH_SCOPES.join(" "))).toEqual([...GOOGLE_OAUTH_SCOPES]);
    expect(
      parseGrantedGoogleScopes(
        `${GOOGLE_OAUTH_SCOPES.join(" ")} https://www.googleapis.com/auth/userinfo.email`,
      ),
    ).toEqual([...GOOGLE_OAUTH_SCOPES]);
    expect(() => parseGrantedGoogleScopes("openid email")).toThrow();
    expect(() => parseGrantedGoogleScopes(`${GOOGLE_OAUTH_SCOPES.join(" ")} https://www.googleapis.com/auth/drive`)).toThrow();
    expect(() => parseGrantedGoogleScopes(`${GOOGLE_OAUTH_SCOPES.join(" ")} https://www.googleapis.com/auth/userinfo.profile`)).toThrow();
  });

  it("refreshes an account-bound credential and encrypts a rotated refresh token", async () => {
    const store = new MemoryOAuthStore();
    await store.saveCredential(
      encryptedGoogleCredential(
        {
          googleSub: configuration.expectedSub,
          email: configuration.expectedEmail,
          scopes: [...GOOGLE_OAUTH_SCOPES],
        },
        {
          access_token: "fake-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "fake-refresh-token",
        },
        configuration.tokenEncryptionKey,
      ),
    );
    const credential = await store.getCredential();
    if (!credential) throw new Error("expected fake credential");

    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("fake-refresh-token");
      return new Response(
        JSON.stringify({
          access_token: "rotated-access-token",
          token_type: "Bearer",
          expires_in: 1800,
          refresh_token: "rotated-refresh-token",
          scope: GOOGLE_OAUTH_SCOPES.join(" "),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const refreshed = await refreshGoogleAccessToken(
      configuration,
      credential,
      configuration.tokenEncryptionKey,
      store,
      fetchImpl,
      new Date("2026-07-16T02:00:00.000Z"),
    );
    expect(refreshed).toEqual({
      accessToken: "rotated-access-token",
      tokenType: "Bearer",
      expiresAt: new Date("2026-07-16T02:30:00.000Z"),
    });
    const rotated = await store.getCredential();
    expect(rotated?.refreshTokenCiphertext).not.toContain("rotated-refresh-token");
    expect(decryptOAuthSecret(rotated!.refreshTokenCiphertext, configuration.tokenEncryptionKey)).toBe("rotated-refresh-token");
  });

  it("keeps the migration source and checksum test fixture server-side", async () => {
    const migration = await readFile(new URL("../../db/migrations/0002_oauth_transaction.sql", import.meta.url), "utf8");
    expect(migration).toContain("oauth_transactions");
    expect(migration).toContain("oauth_credentials");
    expect(migration).toContain("REVOKE ALL ON TABLE oauth_transactions, oauth_credentials FROM PUBLIC");
  });
});
