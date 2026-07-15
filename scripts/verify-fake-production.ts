import { EnvironmentConfigError, parseApplicationEnvironment } from "@/lib/config/environment";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const productionFixtureEnvironment = {
  NODE_ENV: "production",
  APP_BASE_URL: "https://rewind.example.test",
  REWIND_STORAGE_MODE: "memory_fixture",
  REWIND_SESSION_SECRET: "fixture-session-0123456789abcdef0123456789",
  REWIND_DASHBOARD_PASSCODE: "fixture-passcode-1234",
  MCP_BACKEND_TOKEN: "fixture-mcp-token-0123456789abcdef0123456789",
  OPENAI_API_KEY: "fixture-openai-key-0123456789",
  OPENAI_MODEL: "gpt-5.6-sol",
  GOOGLE_CLIENT_ID: "1234567890-rewind.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "fixture-google-secret-0123456",
  GOOGLE_REDIRECT_URI: "https://rewind.example.test/api/v1/oauth/google/callback",
  REWIND_TOKEN_ENCRYPTION_KEY: "fixture-encryption-0123456789abcdef012345",
  REWIND_GOOGLE_EXPECTED_EMAIL: "fixture@example.test",
  REWIND_RECIPIENT_ALLOWLIST: JSON.stringify({ UK: ["uk@example.test"], US: ["us@example.test"] }),
  REWIND_DEMO_DATE: "2026-08-20",
} as const;

export function productionFixtureIsRejected(): boolean {
  try {
    parseApplicationEnvironment(productionFixtureEnvironment);
    return false;
  } catch (error) {
    return (
      error instanceof EnvironmentConfigError &&
      error.issues.some((entry) => entry.field === "REWIND_STORAGE_MODE" && entry.code === "fixture_storage_forbidden_in_production")
    );
  }
}

function main(): void {
  if (!productionFixtureIsRejected()) {
    process.stdout.write('{"status":"failed","check":"production_fixture_rejected"}\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write('{"status":"ok","check":"production_fixture_rejected"}\n');
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) main();
