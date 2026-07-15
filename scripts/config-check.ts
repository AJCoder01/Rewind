import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPrivateLocalEnvironment } from "@/lib/db/config";
import {
  loadApplicationEnvironment,
  loadMcpEnvironment,
  redactEnvironmentError,
} from "@/lib/config/environment";

type Check = Readonly<{ scope: "application" | "mcp"; status: "ok" | "failed"; error?: string }>;

function runCheck(scope: Check["scope"], load: () => unknown): Check {
  try {
    load();
    return { scope, status: "ok" };
  } catch (error) {
    return { scope, status: "failed", error: redactEnvironmentError(error) };
  }
}

export function runConfigCheck(): { status: "ok" | "failed"; checks: readonly Check[] } {
  loadPrivateLocalEnvironment();
  const checks = [
    runCheck("application", loadApplicationEnvironment),
    runCheck("mcp", loadMcpEnvironment),
  ] as const;
  return {
    status: checks.every((check) => check.status === "ok") ? "ok" : "failed",
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
