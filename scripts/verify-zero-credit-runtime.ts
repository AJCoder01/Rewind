import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { OLLAMA_CHAT_ENDPOINT } from "@/lib/ai/ollama-chat";
import { productModelSelection } from "@/lib/ai/product-model";
import { parseApplicationEnvironment, type Environment } from "@/lib/config/environment";

const ZERO_CREDIT_TEST_ENVIRONMENT: Environment = {
  NODE_ENV: "test",
  APP_BASE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://rewind_app:zero-credit-test@127.0.0.1:5432/rewind",
  REWIND_STORAGE_MODE: "postgres",
  REWIND_SESSION_SECRET: "zero-credit-session-secret-000000001",
  REWIND_DASHBOARD_PASSCODE: "zero-credit-passcode",
  MCP_BACKEND_TOKEN: "zero-credit-mcp-token-00000000000001",
  REWIND_MODEL_RUNTIME: "local_ollama",
  REWIND_LOCAL_MODEL: "zero-credit-local-model:latest",
  // Deliberately conflicting stale values prove that only the product selector
  // controls the product model boundary.
  REWIND_S043_MODEL_RUNTIME: "openai_responses",
  OPENAI_API_KEY: "stale-openai-key-0000000000000001",
  OPENAI_MODEL: "stale-openai-model",
  GOOGLE_CLIENT_ID: "zero-credit.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "zero-credit-google-secret",
  GOOGLE_REDIRECT_URI: "http://127.0.0.1:3000/api/v1/oauth/google/callback",
  REWIND_TOKEN_ENCRYPTION_KEY: "zero-credit-encryption-key-00000001",
  REWIND_GOOGLE_EXPECTED_EMAIL: "rewind@example.test",
  REWIND_GOOGLE_EXPECTED_SUB: "zero-credit-google-subject",
  REWIND_GOOGLE_CALENDAR_ID: "zero-credit-calendar",
  REWIND_RECIPIENT_ALLOWLIST: JSON.stringify({
    UK: ["uk@example.test"],
    US: ["us@example.test"],
  }),
  REWIND_DEMO_DATE: "2026-08-20",
};

export function verifyZeroCreditProductRuntime(): Readonly<{
  status: "ok";
  check: "zero_credit_product_runtime";
  runtime: "local_ollama";
  provider: "ollama";
  transport: "loopback";
  externalCalls: 0;
}> {
  const environment = parseApplicationEnvironment(ZERO_CREDIT_TEST_ENVIRONMENT);
  const selection = productModelSelection(environment);
  if (
    selection.runtime !== "local_ollama" ||
    selection.provider !== "ollama" ||
    selection.transport !== "loopback" ||
    OLLAMA_CHAT_ENDPOINT !== "http://127.0.0.1:11434/api/chat"
  ) {
    throw new Error("The zero-credit product runtime did not fail closed to loopback-only Ollama.");
  }
  return {
    status: "ok",
    check: "zero_credit_product_runtime",
    runtime: selection.runtime,
    provider: selection.provider,
    transport: selection.transport,
    externalCalls: 0,
  };
}

function main(): void {
  try {
    process.stdout.write(`${JSON.stringify(verifyZeroCreditProductRuntime())}\n`);
  } catch {
    process.stdout.write('{"status":"failed","check":"zero_credit_product_runtime"}\n');
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) main();
