import {
  ConnectionPreflightSnapshotSchema,
  type ConnectionPreflightSnapshot,
} from "@/lib/contracts/connection-preflight";
import {
  EnvironmentConfigError,
  parseApplicationEnvironment,
  type Environment,
  type EnvironmentIssue,
} from "@/lib/config/environment";
import { getOAuthStore } from "@/lib/db";
import { checkDatabaseReadiness, type DatabaseReadiness } from "@/lib/db/readiness";
import type { OAuthCredentialRecord } from "@/lib/db/oauth-store";
import { GOOGLE_OAUTH_SCOPES } from "@/lib/google/oauth";

type ConnectionPreflightDependencies = Readonly<{
  environment?: Environment;
  checkDatabase?: () => Promise<DatabaseReadiness>;
  readCredential?: () => Promise<OAuthCredentialRecord | null>;
}>;

type ConfigurationState = Readonly<{
  complete: boolean;
  issues: readonly EnvironmentIssue[];
  expectedEmail?: string;
  expectedSub?: string;
  calendarConfigured: boolean;
  demoDateConfigured: boolean;
  storageMode: "memory_fixture" | "postgres" | "unavailable";
}>;

type DatabaseState = Readonly<{
  status: ConnectionPreflightSnapshot["database"]["status"];
  schemaVersion?: string;
}>;

function safeConfiguration(environment: Environment): ConfigurationState {
  try {
    const parsed = parseApplicationEnvironment(environment);
    return {
      complete: true,
      issues: [],
      expectedEmail: parsed.REWIND_GOOGLE_EXPECTED_EMAIL,
      expectedSub: parsed.REWIND_GOOGLE_EXPECTED_SUB,
      calendarConfigured: Boolean(parsed.REWIND_GOOGLE_CALENDAR_ID),
      demoDateConfigured: parsed.REWIND_DEMO_DATE === "2026-08-20",
      storageMode: parsed.REWIND_STORAGE_MODE,
    };
  } catch (error) {
    const issues = error instanceof EnvironmentConfigError
      ? error.issues
      : [{ field: "environment", code: "invalid" } satisfies EnvironmentIssue];
    return {
      complete: false,
      issues,
      expectedEmail: normalizedEmail(environment.REWIND_GOOGLE_EXPECTED_EMAIL),
      expectedSub: safeIdentifier(environment.REWIND_GOOGLE_EXPECTED_SUB),
      calendarConfigured: Boolean(safeIdentifier(environment.REWIND_GOOGLE_CALENDAR_ID)),
      demoDateConfigured: environment.REWIND_DEMO_DATE === "2026-08-20",
      storageMode: storageModeOf(environment),
    };
  }
}

function storageModeOf(environment: Environment): ConfigurationState["storageMode"] {
  if (environment.REWIND_STORAGE_MODE === "memory_fixture" && environment.NODE_ENV !== "production") return "memory_fixture";
  if (environment.REWIND_STORAGE_MODE === "postgres") return "postgres";
  return "unavailable";
}

function normalizedEmail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function safeIdentifier(value: string | undefined): string | undefined {
  if (!value || value.trim() !== value || /\s/.test(value) || value.length > 512) return undefined;
  return value.length > 0 ? value : undefined;
}

function modelRuntimeOf(environment: Environment): ConnectionPreflightSnapshot["runtime"]["modelRuntime"] {
  const selectedRuntime = environment.REWIND_MODEL_RUNTIME
    ?? environment.REWIND_S043_MODEL_RUNTIME
    ?? (safeIdentifier(environment.OPENAI_MODEL) ? "openai_responses" : undefined);
  if (selectedRuntime === "local_ollama" && safeIdentifier(environment.REWIND_LOCAL_MODEL)) return "local_ollama";
  if (selectedRuntime === "openai_responses" && safeIdentifier(environment.OPENAI_MODEL)) return "openai_responses";
  return "not_configured";
}

async function databaseState(
  configuration: ConfigurationState,
  environment: Environment,
  checkDatabase: () => Promise<DatabaseReadiness>,
): Promise<DatabaseState> {
  if (configuration.storageMode === "memory_fixture") return { status: "fixture" };
  if (configuration.storageMode !== "postgres" || !environment.DATABASE_URL) return { status: "unavailable" };
  if (configuration.issues.some((entry) => entry.field === "DATABASE_URL")) return { status: "unavailable" };
  try {
    const readiness = await checkDatabase();
    return readiness.ready
      ? { status: "ready", schemaVersion: readiness.migrationId }
      : { status: "not_ready", schemaVersion: readiness.migrationId };
  } catch {
    return { status: "unavailable" };
  }
}

function identityState(
  configuration: ConfigurationState,
  credential: OAuthCredentialRecord | null,
): ConnectionPreflightSnapshot["identity"] {
  if (!credential) return { status: "not_connected" };
  const email = normalizedEmail(credential.email);
  if (!email || !configuration.expectedEmail || !configuration.expectedSub) return { status: "unavailable" };
  const expectedScopes = [...GOOGLE_OAUTH_SCOPES].sort();
  const actualScopes = [...credential.scopes].sort();
  if (
    email !== configuration.expectedEmail ||
    credential.googleSub !== configuration.expectedSub ||
    actualScopes.length !== expectedScopes.length ||
    actualScopes.some((scope, index) => scope !== expectedScopes[index])
  ) {
    return { status: "mismatch" };
  }
  return { status: "connected", email };
}

function preflightCheck(
  id: "configuration" | "database" | "google_identity" | "calendar",
  status: "passed" | "failed" | "not_run",
  detail: string,
): { id: typeof id; status: typeof status; detail: string } {
  return { id, status, detail };
}

export async function readConnectionPreflightStatus(
  dependencies: ConnectionPreflightDependencies = {},
): Promise<ConnectionPreflightSnapshot> {
  const environment = dependencies.environment ?? process.env;
  const configuration = safeConfiguration(environment);
  const checkDatabase = dependencies.checkDatabase ?? checkDatabaseReadiness;
  const database = await databaseState(configuration, environment, checkDatabase);

  let identity: ConnectionPreflightSnapshot["identity"];
  if (database.status === "unavailable" || (configuration.storageMode === "postgres" && database.status !== "ready")) {
    identity = { status: "unavailable" };
  } else {
    try {
      const credential = await (dependencies.readCredential ?? (() => getOAuthStore().getCredential()))();
      identity = identityState(configuration, credential);
    } catch {
      identity = { status: "unavailable" };
    }
  }

  const databaseCheck = database.status === "fixture"
    ? preflightCheck("database", "not_run", "Fixture storage is active; live PostgreSQL readiness was not checked.")
    : database.status === "ready"
      ? preflightCheck("database", "passed", "The restricted PostgreSQL readiness checks passed.")
      : preflightCheck("database", "failed", "PostgreSQL readiness did not pass; no product workflow is available.");
  const identityCheck = identity.status === "connected"
    ? preflightCheck("google_identity", "passed", "The stored Google identity matches the configured account.")
    : identity.status === "mismatch"
      ? preflightCheck("google_identity", "failed", "The stored Google identity does not match the configured account.")
      : identity.status === "not_connected"
        ? preflightCheck("google_identity", "failed", "No approved Google connection is stored.")
        : preflightCheck("google_identity", "failed", "The Google connection could not be checked safely.");
  const calendarCheck = !configuration.calendarConfigured
    ? preflightCheck("calendar", "failed", "The controlled Calendar target is not configured.")
    : preflightCheck("calendar", "not_run", "Human-gated Calendar preflight has not run from this dashboard.");
  const checks = [
    preflightCheck(
      "configuration",
      configuration.complete ? "passed" : "failed",
      configuration.complete ? "Required application configuration is present." : "Required application configuration has safe, reviewable gaps.",
    ),
    databaseCheck,
    identityCheck,
    calendarCheck,
  ] as const;
  const hasFailure = checks.some((check) => check.status === "failed");
  const preflightStatus: ConnectionPreflightSnapshot["preflight"]["status"] = hasFailure ? "blocked" : "not_run";
  const runtimeMode: ConnectionPreflightSnapshot["runtime"]["mode"] = configuration.storageMode === "memory_fixture"
    ? "fixture"
    : configuration.storageMode === "postgres" && configuration.complete
      ? "live_capable"
      : "blocked";
  const modelRuntime = modelRuntimeOf(environment);
  const workflowReady = runtimeMode === "live_capable"
    && configuration.complete
    && database.status === "ready"
    && identity.status === "connected"
    && configuration.calendarConfigured
    && configuration.demoDateConfigured
    && modelRuntime !== "not_configured";

  return ConnectionPreflightSnapshotSchema.parse({
    contractVersion: "connection-preflight.v2",
    overall: hasFailure || runtimeMode !== "live_capable" ? "blocked" : "attention",
    runtime: {
      mode: runtimeMode,
      modelRuntime,
      productExecution: workflowReady ? "enabled" : "disabled",
      productReset: "disabled",
    },
    configuration: { status: configuration.complete ? "complete" : "incomplete", issues: configuration.issues },
    identity,
    database,
    calendar: { status: configuration.calendarConfigured ? "configured" : "not_configured" },
    demoDate: { status: configuration.demoDateConfigured ? "configured" : "not_configured" },
    preflight: { status: preflightStatus, checks },
    workflow: {
      status: workflowReady ? "ready" : "disabled",
      message: workflowReady
        ? "Provider-grounded planning is ready; exact dashboard approval and just-in-time preflight are still required before execution."
        : "Product execution remains disabled until every required configuration, storage, identity, Calendar, and model check is available.",
    },
  });
}
