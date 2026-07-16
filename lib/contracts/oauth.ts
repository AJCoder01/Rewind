import { z } from "zod";

/**
 * The callback query is parsed before any transaction lookup.  Provider error
 * descriptions are accepted only as bounded input and are never reflected in
 * a response or log.
 */
export const GoogleOAuthCallbackQuerySchema = z
  .object({
    state: z.string().min(1).max(512),
    code: z.string().min(1).max(8192).optional(),
    error: z.string().min(1).max(200).optional(),
    error_description: z.string().min(1).max(1000).optional(),
    error_uri: z.string().url().max(2000).optional(),
    // Google includes bounded response metadata alongside `code` and `state`.
    // These values are informational only; authorization remains bound to the
    // stored state, redirect, client, PKCE verifier, and returned token.
    scope: z.string().min(1).max(4096).optional(),
    authuser: z.string().regex(/^\d+$/).max(8).optional(),
    hd: z.string().min(1).max(255).optional(),
    prompt: z.string().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.code) === Boolean(value.error)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["code"], message: "OAuth callback must contain exactly one code or provider error" });
    }
    if (!value.error && (value.error_description || value.error_uri)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["error_description"], message: "OAuth error details require a provider error" });
    }
  });

export type GoogleOAuthCallbackQuery = z.infer<typeof GoogleOAuthCallbackQuerySchema>;

const GoogleOidcAudienceSchema = z.union([
  z.string().min(1).max(255),
  z
    .array(z.string().min(1).max(255))
    .min(1)
    .max(8)
    .refine((values) => new Set(values).size === values.length, "OIDC audience must not contain duplicates"),
]);

/**
 * Google ID-token payload boundary.  The schema is strict so an unexpected
 * provider claim cannot silently become application input.  Optional fields
 * are the documented Google/OIDC claims that may accompany the fields this
 * application actually validates.
 */
export const GoogleOidcClaimsSchema = z
  .object({
    iss: z.union([z.literal("https://accounts.google.com"), z.literal("accounts.google.com")]),
    sub: z.string().min(1).max(255).refine((value) => value === value.trim() && !/\s/.test(value)),
    aud: GoogleOidcAudienceSchema,
    azp: z.string().min(1).max(255).optional(),
    exp: z.number().int().nonnegative(),
    iat: z.number().int().nonnegative(),
    nonce: z.string().min(1).max(512),
    email: z.string().email().max(320),
    email_verified: z.boolean(),
    at_hash: z.string().min(1).max(512).optional(),
    c_hash: z.string().min(1).max(512).optional(),
    auth_time: z.number().int().nonnegative().optional(),
    acr: z.string().min(1).max(255).optional(),
    amr: z.array(z.string().min(1).max(255)).max(8).optional(),
    jti: z.string().min(1).max(512).optional(),
    name: z.string().max(500).optional(),
    picture: z.string().max(2048).optional(),
    given_name: z.string().max(250).optional(),
    family_name: z.string().max(250).optional(),
    locale: z.string().max(32).optional(),
    hd: z.string().max(255).optional(),
  })
  .strict();

export type GoogleOidcClaims = z.infer<typeof GoogleOidcClaimsSchema>;

export const GoogleOidcJwtHeaderSchema = z
  .object({
    alg: z.literal("RS256"),
    kid: z.string().min(1).max(255),
    typ: z.literal("JWT").optional(),
  })
  .strict();

export type GoogleOidcJwtHeader = z.infer<typeof GoogleOidcJwtHeaderSchema>;
