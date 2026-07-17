import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPrivateLocalEnvironment } from "@/lib/db/config";
import {
  loadApplicationEnvironment,
  loadMcpEnvironment,
  redactEnvironmentError,
} from "@/lib/config/environment";

type Check = Readonly<{ scope: "application" | "mcp"; status: "ok" | "failed"; error?: string }>;
type ModelRuntimeStatus = "openai_responses" | "local_ollama" | "not_configured" | "invalid";

type ConfigCheckResult = Readonly<{
  status: "ok" | "failed";
  productModelRuntime: ModelRuntimeStatus;
  providerSpikeModelRuntime: ModelRuntimeStatus;
  checks: readonly Check[];
}>;

function runCheck(scope: Check["scope"], load: () => unknown): Check {
  try {
    load();
    return { scope, status: "ok" };
  } catch (error) {
    return { scope, status: "failed", error: redactEnvironmentError(error) };
  }
}

function runtimeStatus(value: unknown): ModelRuntimeStatus {
  if (value === undefined) return "not_configured";
  if (value === "openai_responses" || value === "local_ollama") return value;
  return "invalid";
}

export function configuredModelRuntimes(environment: object): Readonly<{
  productModelRuntime: ModelRuntimeStatus;
  providerSpikeModelRuntime: ModelRuntimeStatus;
}> {
  const values = environment as Readonly<{
    REWIND_MODEL_RUNTIME?: unknown;
    REWIND_S043_MODEL_RUNTIME?: unknown;
  }>;
  return {
    productModelRuntime: runtimeStatus(values.REWIND_MODEL_RUNTIME),
    providerSpikeModelRuntime: runtimeStatus(values.REWIND_S043_MODEL_RUNTIME),
  };
}

export function runConfigCheck(): ConfigCheckResult {
  loadPrivateLocalEnvironment();
  let { productModelRuntime, providerSpikeModelRuntime } = configuredModelRuntimes(process.env);
  const checks = [
    runCheck("application", () => {
      const environment = loadApplicationEnvironment();
      ({ productModelRuntime, providerSpikeModelRuntime } = configuredModelRuntimes(environment));
    }),
    runCheck("mcp", loadMcpEnvironment),
  ] as const;
  return {
    status: checks.every((check) => check.status === "ok") ? "ok" : "failed",
    productModelRuntime,
    providerSpikeModelRuntime,
    checks,
  };
}

async function main(): Promise<void> {
  const result = runConfigCheck();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "failed") process.exitCode = 1;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main().catch(() => {
    process.stdout.write('{"status":"failed","checks":[]}\n');
    process.exitCode = 1;
  });
}
