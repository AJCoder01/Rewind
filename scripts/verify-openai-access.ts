import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPrivateLocalEnvironment } from "@/lib/db/config";

type Environment = Readonly<Record<string, string | undefined>>;

export type OpenAiAccessResult =
  | { status: "ok"; model: string }
  | { status: "failed"; model?: string };

type JsonRecord = Record<string, unknown>;

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models/";
const ACCESS_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readModel(environment: Environment): string | undefined {
  const model = environment.OPENAI_MODEL;
  if (!model || model !== model.trim()) return undefined;
  return model;
}

function readKey(environment: Environment): string | undefined {
  const key = environment.OPENAI_API_KEY;
  if (!key || key !== key.trim()) return undefined;
  return key;
}

/**
 * Performs the smallest provider-grounded check needed by S011.
 *
 * This function is intentionally inert on import. Callers must invoke it
 * explicitly, and tests can inject fetch so no live provider call is made.
 */
export async function verifyOpenAiAccess(
  environment: Environment = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenAiAccessResult> {
  const model = readModel(environment);
  const key = readKey(environment);
  if (!model || !key) return { status: "failed", ...(model ? { model } : {}) };

  try {
    const response = await fetchImpl(`${OPENAI_MODELS_URL}${encodeURIComponent(model)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(ACCESS_TIMEOUT_MS),
    });
    if (!response.ok) return { status: "failed", model };

    // Parse only the model identifier. Never surface the provider response or
    // its error fields, which could contain sensitive diagnostics.
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.id !== model) return { status: "failed", model };
    return { status: "ok", model };
  } catch {
    // Provider/network errors are deliberately collapsed into a safe result.
    return { status: "failed", model };
  }
}

async function main(): Promise<void> {
  loadPrivateLocalEnvironment();
  const result = await verifyOpenAiAccess();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "failed") process.exitCode = 1;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main().catch(() => {
    // Keep the CLI contract safe even if local environment loading fails.
    process.stdout.write('{"status":"failed"}\n');
    process.exitCode = 1;
  });
}
