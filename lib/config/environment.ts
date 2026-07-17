import { requireDatabaseUrl } from "@/lib/db/config";
import { validateGoogleRedirectUri } from "@/lib/google/redirects";
import { z } from "zod";

/**
 * Server configuration boundary for the Rewind MVP.
 *
 * This module is deliberately inert on import.  `parse*Environment` functions
 * are pure and accept an explicit record for tests; `load*Environment` reads
 * process.env only when a server caller explicitly asks for it.  Do not import
 * this module from client components or serialize the returned configuration.
 */

export type Environment = Readonly<Record<string, string | undefined>>;
export type EnvironmentMode = "development" | "test" | "production";

const environmentModes = ["development", "test", "production"] as const;

const PLACEHOLDER_VALUES = new Set([
  "",
  "change-me",
  "changeme",
  "replace-me",
  "replace_me",
  "your-secret",
  "your-password",
  "[your-password]",
  "example",
  "example-secret",
  "test-secret",
]);

const emailSchema = z
  .string()
  .trim()
  .max(320, "must be at most 320 characters")
  .email("must be an email address")
  .transform((value) => value.toLowerCase());

const privateSecretSchema = (minimumLength: number, label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .min(minimumLength, `${label} is too short`)
    .refine((value) => value === value.trim() && !/\s/.test(value), `${label} must not contain whitespace`)
    .refine((value) => !PLACEHOLDER_VALUES.has(value.toLowerCase()), `${label} must be a private value`);

const identifierSchema = (label: string, maximumLength = 512) =>
  z
    .string({ required_error: `${label} is required` })
    .min(1, `${label} is required`)
    .max(maximumLength, `${label} is too long`)
    .refine((value) => value === value.trim() && !/\s/.test(value), `${label} must not contain whitespace`);

const modelRuntimeSchema = z.enum(["openai_responses", "local_ollama"] as const);
export type ModelRuntime = z.infer<typeof modelRuntimeSchema>;
const modelIdentifierSchema = (label: string) => identifierSchema(label, 200).refine(
  (value) => /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value),
  `${label} contains unsupported characters`,
);
const localModelIdentifierSchema = modelIdentifierSchema("REWIND_LOCAL_MODEL").refine(
  (value) => !value.toLowerCase().endsWith(":cloud"),
  "REWIND_LOCAL_MODEL must be a local model",
);

const recipientAllowlistSchema = z
  .object({
    UK: z.array(emailSchema).length(1, "UK must contain exactly one recipient"),
    US: z.array(emailSchema).length(1, "US must contain exactly one recipient"),
  })
  .strict()
  .superRefine((allowlist, context) => {
    if (allowlist.UK[0] === allowlist.US[0]) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["US"], message: "UK and US recipients must differ" });
    }
  });

const rawApplicationEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(environmentModes).optional(),
    APP_BASE_URL: z.string({ required_error: "APP_BASE_URL is required" }).min(1, "APP_BASE_URL is required"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL must not be empty").optional(),
    REWIND_STORAGE_MODE: z.enum(["memory_fixture", "postgres"] as const, {
      required_error: "REWIND_STORAGE_MODE is required",
    }),
    REWIND_SESSION_SECRET: privateSecretSchema(32, "REWIND_SESSION_SECRET"),
    REWIND_DASHBOARD_PASSCODE: privateSecretSchema(12, "REWIND_DASHBOARD_PASSCODE"),
    MCP_BACKEND_TOKEN: privateSecretSchema(32, "MCP_BACKEND_TOKEN"),
    OPENAI_API_KEY: privateSecretSchema(20, "OPENAI_API_KEY").optional(),
    OPENAI_MODEL: modelIdentifierSchema("OPENAI_MODEL").optional(),
    REWIND_MODEL_RUNTIME: modelRuntimeSchema.optional(),
    // Spike-only selector retained for the historical S043 admin command. It
    // never selects or overrides the product runtime.
    REWIND_S043_MODEL_RUNTIME: modelRuntimeSchema.optional(),
    REWIND_LOCAL_MODEL: localModelIdentifierSchema.optional(),
    GOOGLE_CLIENT_ID: z
      .string({ required_error: "GOOGLE_CLIENT_ID is required" })
      .regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/, "GOOGLE_CLIENT_ID is not a web client ID"),
    GOOGLE_CLIENT_SECRET: privateSecretSchema(16, "GOOGLE_CLIENT_SECRET"),
    GOOGLE_REDIRECT_URI: z.string({ required_error: "GOOGLE_REDIRECT_URI is required" }).min(1, "GOOGLE_REDIRECT_URI is required"),
    REWIND_TOKEN_ENCRYPTION_KEY: privateSecretSchema(32, "REWIND_TOKEN_ENCRYPTION_KEY"),
    REWIND_GOOGLE_EXPECTED_EMAIL: emailSchema,
    // The stable Google subject is required before an OAuth credential can be
    // accepted.  The calendar binding remains deferred until Calendar
    // discovery obtains it.  Neither value is ever logged by this module.
    REWIND_GOOGLE_EXPECTED_SUB: identifierSchema("REWIND_GOOGLE_EXPECTED_SUB", 255),
    REWIND_GOOGLE_CALENDAR_ID: identifierSchema("REWIND_GOOGLE_CALENDAR_ID").optional(),
    GOOGLE_REFRESH_TOKEN_CIPHERTEXT: privateSecretSchema(32, "GOOGLE_REFRESH_TOKEN_CIPHERTEXT").optional(),
    REWIND_RECIPIENT_ALLOWLIST: z
      .string({ required_error: "REWIND_RECIPIENT_ALLOWLIST is required" })
      .min(1, "REWIND_RECIPIENT_ALLOWLIST is required"),
    REWIND_DEMO_DATE: z
      .string({ required_error: "REWIND_DEMO_DATE is required" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "REWIND_DEMO_DATE must use YYYY-MM-DD"),
  })
  .strict();

const rawMcpEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(environmentModes).optional(),
    APP_BASE_URL: z.string({ required_error: "APP_BASE_URL is required" }).min(1, "APP_BASE_URL is required"),
    MCP_BACKEND_TOKEN: privateSecretSchema(32, "MCP_BACKEND_TOKEN"),
  })
  .strict();

export const ApplicationEnvironmentSchema = rawApplicationEnvironmentSchema;
export const McpEnvironmentSchema = rawMcpEnvironmentSchema;
export const RecipientAllowlistSchema = recipientAllowlistSchema;

export type RecipientAllowlist = z.infer<typeof RecipientAllowlistSchema>;

export type ApplicationEnvironment = Readonly<{
  NODE_ENV: EnvironmentMode;
  APP_BASE_URL: string;
  DATABASE_URL?: string;
  REWIND_STORAGE_MODE: "memory_fixture" | "postgres";
  REWIND_SESSION_SECRET: string;
  REWIND_DASHBOARD_PASSCODE: string;
  MCP_BACKEND_TOKEN: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  REWIND_MODEL_RUNTIME?: ModelRuntime;
  REWIND_S043_MODEL_RUNTIME?: ModelRuntime;
  REWIND_LOCAL_MODEL?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  REWIND_TOKEN_ENCRYPTION_KEY: string;
  REWIND_GOOGLE_EXPECTED_EMAIL: string;
  REWIND_GOOGLE_EXPECTED_SUB: string;
  REWIND_GOOGLE_CALENDAR_ID?: string;
  GOOGLE_REFRESH_TOKEN_CIPHERTEXT?: string;
  REWIND_RECIPIENT_ALLOWLIST: RecipientAllowlist;
  REWIND_DEMO_DATE: string;
}>;

export type McpEnvironment = Readonly<{
  NODE_ENV: EnvironmentMode;
  APP_BASE_URL: string;
  MCP_BACKEND_TOKEN: string;
}>;

export type EnvironmentIssue = Readonly<{ field: string; code: string }>;

/** Safe error type: it stores field names and validation codes, never inputs. */
export class EnvironmentConfigError extends Error {
  readonly issues: readonly EnvironmentIssue[];

  constructor(issues: readonly EnvironmentIssue[]) {
    const uniqueIssues = Array.from(
      new Map(issues.map((issue) => [`${issue.field}:${issue.code}`, issue])).values(),
    ).sort((left, right) => left.field.localeCompare(right.field));
    super(
      uniqueIssues.length === 0
        ? "Invalid private environment configuration."
        : `Invalid private environment configuration: ${uniqueIssues.map((issue) => issue.field).join(", ")}`,
    );
    this.name = "EnvironmentConfigError";
    this.issues = uniqueIssues;
  }

  toJSON(): { name: string; fields: string[] } {
    return { name: this.name, fields: this.issues.map((issue) => issue.field) };
  }
}

function issue(field: string, code: string): EnvironmentIssue {
  return { field, code };
}

function issuesFromZod(error: z.ZodError, prefix = ""): EnvironmentIssue[] {
  return error.issues.map((entry) => {
    const path = [prefix, ...entry.path.map(String)].filter(Boolean).join(".");
    return issue(path || prefix || "environment", entry.code);
  });
}

function throwIfIssues(issues: EnvironmentIssue[]): void {
  if (issues.length > 0) throw new EnvironmentConfigError(issues);
}

function pick(environment: Environment, keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, environment[key]]));
}

function modeOf(environment: Environment, parsed?: EnvironmentMode): EnvironmentMode {
  return parsed ?? (environment.NODE_ENV === undefined ? "development" : (environment.NODE_ENV as EnvironmentMode));
}

function validatePublicOrigin(value: string, mode: EnvironmentMode): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
  if (mode === "production") {
    if (parsed.protocol !== "https:") return null;
    if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())) return null;
  }
  return parsed.origin;
}

function validIsoDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function parseAllowlist(value: string): RecipientAllowlist | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    return null;
  }
  const parsed = RecipientAllowlistSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

const applicationKeys = [
  "NODE_ENV",
  "APP_BASE_URL",
  "DATABASE_URL",
  "REWIND_STORAGE_MODE",
  "REWIND_SESSION_SECRET",
  "REWIND_DASHBOARD_PASSCODE",
  "MCP_BACKEND_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "REWIND_MODEL_RUNTIME",
  "REWIND_S043_MODEL_RUNTIME",
  "REWIND_LOCAL_MODEL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "REWIND_TOKEN_ENCRYPTION_KEY",
  "REWIND_GOOGLE_EXPECTED_EMAIL",
  "REWIND_GOOGLE_EXPECTED_SUB",
  "REWIND_GOOGLE_CALENDAR_ID",
  "GOOGLE_REFRESH_TOKEN_CIPHERTEXT",
  "REWIND_RECIPIENT_ALLOWLIST",
  "REWIND_DEMO_DATE",
] as const;

/** Parse a supplied environment record without reading process.env. */
export function parseApplicationEnvironment(environment: Environment): ApplicationEnvironment {
  const raw = rawApplicationEnvironmentSchema.safeParse(pick(environment, applicationKeys));
  if (!raw.success) throw new EnvironmentConfigError(issuesFromZod(raw.error));

  const value = raw.data;
  const mode = modeOf(environment, value.NODE_ENV);
  const issues: EnvironmentIssue[] = [];
  const appBaseUrl = validatePublicOrigin(value.APP_BASE_URL, mode);
  if (!appBaseUrl) issues.push(issue("APP_BASE_URL", "invalid_origin"));

  if (value.REWIND_STORAGE_MODE === "postgres" && !value.DATABASE_URL) {
    issues.push(issue("DATABASE_URL", "required_for_postgres"));
  }
  if (value.REWIND_STORAGE_MODE === "postgres" && !value.REWIND_MODEL_RUNTIME) {
    issues.push(issue("REWIND_MODEL_RUNTIME", "required_for_postgres"));
  }
  const modelRuntime = value.REWIND_MODEL_RUNTIME;
  if (value.REWIND_STORAGE_MODE === "postgres" && modelRuntime === "openai_responses") {
    if (!value.OPENAI_API_KEY) issues.push(issue("OPENAI_API_KEY", "required_for_openai_runtime"));
    if (!value.OPENAI_MODEL) issues.push(issue("OPENAI_MODEL", "required_for_openai_runtime"));
  }
  if (value.REWIND_STORAGE_MODE === "postgres" && modelRuntime === "local_ollama" && !value.REWIND_LOCAL_MODEL) {
    issues.push(issue("REWIND_LOCAL_MODEL", "required_for_local_runtime"));
  }
  if (mode === "production" && value.REWIND_STORAGE_MODE !== "postgres") {
    issues.push(issue("REWIND_STORAGE_MODE", "fixture_storage_forbidden_in_production"));
  }
  if (value.DATABASE_URL) {
    try {
      requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: value.DATABASE_URL });
      const parsedDatabase = new URL(value.DATABASE_URL);
      if (mode === "production" && ["localhost", "127.0.0.1", "::1"].includes(parsedDatabase.hostname.toLowerCase())) {
        issues.push(issue("DATABASE_URL", "local_database_forbidden_in_production"));
      }
    } catch {
      issues.push(issue("DATABASE_URL", "invalid_postgres_url"));
    }
  }

  if (appBaseUrl) {
    try {
      validateGoogleRedirectUri(appBaseUrl, value.GOOGLE_REDIRECT_URI);
    } catch {
      issues.push(issue("GOOGLE_REDIRECT_URI", "must_match_app_origin"));
    }
  }

  if (!validIsoDate(value.REWIND_DEMO_DATE)) {
    issues.push(issue("REWIND_DEMO_DATE", "invalid_calendar_date"));
  } else if (value.REWIND_DEMO_DATE !== "2026-08-20") {
    issues.push(issue("REWIND_DEMO_DATE", "must_match_controlled_demo_date"));
  }
  if (value.REWIND_DEMO_DATE !== "2026-08-20") issues.push(issue("REWIND_DEMO_DATE", "unexpected_demo_date"));
  const allowlist = parseAllowlist(value.REWIND_RECIPIENT_ALLOWLIST);
  if (!allowlist) issues.push(issue("REWIND_RECIPIENT_ALLOWLIST", "invalid_json_shape"));

  const secretPairs: Array<readonly [string, string]> = [
    ["REWIND_SESSION_SECRET", value.REWIND_SESSION_SECRET],
    ["REWIND_DASHBOARD_PASSCODE", value.REWIND_DASHBOARD_PASSCODE],
    ["MCP_BACKEND_TOKEN", value.MCP_BACKEND_TOKEN],
    ["REWIND_TOKEN_ENCRYPTION_KEY", value.REWIND_TOKEN_ENCRYPTION_KEY],
  ];
  for (let index = 0; index < secretPairs.length; index += 1) {
    for (let other = index + 1; other < secretPairs.length; other += 1) {
      if (secretPairs[index][1] === secretPairs[other][1]) {
        issues.push(issue(secretPairs[index][0], "secret_reused"));
        issues.push(issue(secretPairs[other][0], "secret_reused"));
      }
    }
  }

  throwIfIssues(issues);
  // `appBaseUrl` and `allowlist` are known after the checks above; this guard
  // keeps TypeScript from widening the values while preserving fail-closed use.
  if (!appBaseUrl || !allowlist) throw new EnvironmentConfigError([]);
  return {
    NODE_ENV: mode,
    APP_BASE_URL: appBaseUrl,
    ...(value.DATABASE_URL ? { DATABASE_URL: value.DATABASE_URL } : {}),
    REWIND_STORAGE_MODE: value.REWIND_STORAGE_MODE,
    REWIND_SESSION_SECRET: value.REWIND_SESSION_SECRET,
    REWIND_DASHBOARD_PASSCODE: value.REWIND_DASHBOARD_PASSCODE,
    MCP_BACKEND_TOKEN: value.MCP_BACKEND_TOKEN,
    ...(value.OPENAI_API_KEY ? { OPENAI_API_KEY: value.OPENAI_API_KEY } : {}),
    ...(value.OPENAI_MODEL ? { OPENAI_MODEL: value.OPENAI_MODEL } : {}),
    ...(value.REWIND_MODEL_RUNTIME ? { REWIND_MODEL_RUNTIME: value.REWIND_MODEL_RUNTIME } : {}),
    ...(value.REWIND_S043_MODEL_RUNTIME ? { REWIND_S043_MODEL_RUNTIME: value.REWIND_S043_MODEL_RUNTIME } : {}),
    ...(value.REWIND_LOCAL_MODEL ? { REWIND_LOCAL_MODEL: value.REWIND_LOCAL_MODEL } : {}),
    GOOGLE_CLIENT_ID: value.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: value.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: value.GOOGLE_REDIRECT_URI,
    REWIND_TOKEN_ENCRYPTION_KEY: value.REWIND_TOKEN_ENCRYPTION_KEY,
    REWIND_GOOGLE_EXPECTED_EMAIL: value.REWIND_GOOGLE_EXPECTED_EMAIL,
    REWIND_GOOGLE_EXPECTED_SUB: value.REWIND_GOOGLE_EXPECTED_SUB,
    ...(value.REWIND_GOOGLE_CALENDAR_ID ? { REWIND_GOOGLE_CALENDAR_ID: value.REWIND_GOOGLE_CALENDAR_ID } : {}),
    ...(value.GOOGLE_REFRESH_TOKEN_CIPHERTEXT
      ? { GOOGLE_REFRESH_TOKEN_CIPHERTEXT: value.GOOGLE_REFRESH_TOKEN_CIPHERTEXT }
      : {}),
    REWIND_RECIPIENT_ALLOWLIST: allowlist,
    REWIND_DEMO_DATE: value.REWIND_DEMO_DATE,
  };
}

/** Parse only the values needed by the thin authenticated MCP process. */
export function parseMcpEnvironment(environment: Environment): McpEnvironment {
  const raw = rawMcpEnvironmentSchema.safeParse(pick(environment, ["NODE_ENV", "APP_BASE_URL", "MCP_BACKEND_TOKEN"]));
  if (!raw.success) throw new EnvironmentConfigError(issuesFromZod(raw.error));
  const mode = modeOf(environment, raw.data.NODE_ENV);
  const appBaseUrl = validatePublicOrigin(raw.data.APP_BASE_URL, mode);
  if (!appBaseUrl) throw new EnvironmentConfigError([issue("APP_BASE_URL", "invalid_origin")]);
  return { NODE_ENV: mode, APP_BASE_URL: appBaseUrl, MCP_BACKEND_TOKEN: raw.data.MCP_BACKEND_TOKEN };
}

/** Lazy server entry points.  No environment value is read during import. */
export function loadApplicationEnvironment(): ApplicationEnvironment {
  return parseApplicationEnvironment(process.env);
}

export function loadMcpEnvironment(): McpEnvironment {
  return parseMcpEnvironment(process.env);
}

// Short aliases keep call sites readable while the longer names document the
// boundary when it is imported from a route or startup command.
export const parseAppEnvironment = parseApplicationEnvironment;
export const loadAppEnvironment = loadApplicationEnvironment;
export const requireApplicationEnvironment = loadApplicationEnvironment;
export const requireMcpEnvironment = loadMcpEnvironment;

/** Collapse arbitrary failures into a safe message for logs/UI boundaries. */
export function redactEnvironmentError(error: unknown): string {
  return error instanceof EnvironmentConfigError ? error.message : "Invalid private environment configuration.";
}
