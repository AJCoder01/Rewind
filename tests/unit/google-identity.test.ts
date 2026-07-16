import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashOAuthSecret } from "@/lib/google/oauth";
import {
  GoogleIdentityValidationError,
  type GoogleJwk,
  verifyGoogleIdToken,
} from "@/lib/google/oidc";

const clientId = "123456789-rewind.apps.googleusercontent.com";
const now = new Date("2026-07-16T01:02:03.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const exportedJwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
const jwk: GoogleJwk = {
  kty: "RSA",
  kid: "rewind-test-key",
  n: exportedJwk.n,
  e: exportedJwk.e,
  alg: "RS256",
  use: "sig",
};

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function makeIdToken(
  overrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {},
): string {
  const header = { alg: "RS256", kid: jwk.kid, typ: "JWT", ...headerOverrides };
  const claims = {
    iss: "https://accounts.google.com",
    sub: "google-subject",
    aud: clientId,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
    nonce: "oauth-nonce",
    email: "rewind-demo@example.test",
    email_verified: true,
    ...overrides,
  };
  const encodedHeader = base64UrlJson(header);
  const encodedClaims = base64UrlJson(claims);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput, "ascii");
  signer.end();
  return `${signingInput}.${signer.sign(privateKey).toString("base64url")}`;
}

function validationOptions() {
  return {
    clientId,
    expectedEmail: "rewind-demo@example.test",
    expectedSub: "google-subject",
    nonceHash: hashOAuthSecret("oauth-nonce"),
    now,
    jwks: { keys: [jwk] },
  };
}

describe("Google signed identity validation", () => {
  it("accepts a signed Google ID token with the configured account and nonce", async () => {
    await expect(verifyGoogleIdToken(makeIdToken(), validationOptions())).resolves.toEqual({
      googleSub: "google-subject",
      email: "rewind-demo@example.test",
    });
  });

  it.each([
    ["wrong issuer", { iss: "https://attacker.example.test" }],
    ["wrong audience", { aud: "other-client.apps.googleusercontent.com" }],
    ["expired", { exp: nowSeconds - 301 }],
    ["issued in the future", { iat: nowSeconds + 301 }],
    ["wrong nonce", { nonce: "different-nonce" }],
    ["unverified email", { email_verified: false }],
    ["wrong stable subject", { sub: "another-google-subject" }],
    ["wrong account email", { email: "other@example.test" }],
  ])("rejects %s before an identity can be persisted", async (_label, overrides) => {
    await expect(verifyGoogleIdToken(makeIdToken(overrides), validationOptions())).rejects.toBeInstanceOf(
      GoogleIdentityValidationError,
    );
  });

  it("rejects a forged signature and non-RS256 algorithm", async () => {
    const forged = makeIdToken({ email: "rewind-demo@example.test" }).slice(0, -2) + "aa";
    await expect(verifyGoogleIdToken(forged, validationOptions())).rejects.toBeInstanceOf(GoogleIdentityValidationError);
    await expect(
      verifyGoogleIdToken(makeIdToken({}, { alg: "HS256" }), validationOptions()),
    ).rejects.toBeInstanceOf(GoogleIdentityValidationError);
  });

  it("supports a multi-audience token only when azp names the configured client", async () => {
    await expect(
      verifyGoogleIdToken(makeIdToken({ aud: [clientId, "another-client.apps.googleusercontent.com"], azp: clientId }), validationOptions()),
    ).resolves.toMatchObject({ googleSub: "google-subject" });
    await expect(
      verifyGoogleIdToken(makeIdToken({ aud: [clientId, "another-client.apps.googleusercontent.com"], azp: "other-client" }), validationOptions()),
    ).rejects.toBeInstanceOf(GoogleIdentityValidationError);
  });

  it("rejects an unrecognized provider claim at the strict token boundary", async () => {
    await expect(verifyGoogleIdToken(makeIdToken({ unexpected: "data" }), validationOptions())).rejects.toBeInstanceOf(
      GoogleIdentityValidationError,
    );
  });
});
