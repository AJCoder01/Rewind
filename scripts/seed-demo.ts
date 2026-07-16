import { Pool } from "pg";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createOpaqueId } from "@/lib/domain/ids";
import { loadPrivateLocalEnvironment, requireDatabaseUrl } from "@/lib/db/config";
import { loadApplicationEnvironment } from "@/lib/config/environment";
import { PostgresDemoEventStateStore } from "@/lib/db/demo-event-state";
import { PostgresOAuthStore } from "@/lib/db/oauth-store";
import { refreshGoogleAccessToken } from "@/lib/google/credentials";
import { GoogleCalendarPort } from "@/lib/google/calendar";
import {
  assertTtyGatedDemoEnvironment,
  calendarDemoConfigurationFromEnvironment,
  confirmationPhrase,
  safeDemoCommandFailureCode,
  targetFingerprint,
} from "@/lib/services/calendar-demo-command";
import { seedControlledCalendar } from "@/lib/services/calendar-demo";

async function main(): Promise<void> {
  let pool: Pool | undefined;
  try {
    loadPrivateLocalEnvironment();
    assertTtyGatedDemoEnvironment(process.env, {
      stdinIsTTY: process.stdin.isTTY,
      stdoutIsTTY: process.stdout.isTTY,
    });
    const environment = loadApplicationEnvironment();
    const configuration = calendarDemoConfigurationFromEnvironment(environment);
    const databaseUrl = requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: environment.DATABASE_URL });
    const runId = createOpaqueId("seed_");
    const fingerprint = targetFingerprint(configuration.calendarId, databaseUrl);
    const confirmation = confirmationPhrase("seed", runId, configuration.calendarId);
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await readline.question(
      `S035 will seed exactly two controlled Calendar events in Calendar ${configuration.calendarId} (target fingerprint ${fingerprint}). Type "${confirmation}" to continue: `,
    );
    readline.close();
    if (answer.trim() !== confirmation) {
      process.stdout.write('{"status":"cancelled","operation":"seed"}\n');
      return;
    }

    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const oauthStore = new PostgresOAuthStore(pool);
    const credential = await oauthStore.getCredential();
    if (
      !credential ||
      credential.googleSub !== environment.REWIND_GOOGLE_EXPECTED_SUB ||
      credential.email !== environment.REWIND_GOOGLE_EXPECTED_EMAIL
    ) {
      throw new Error("Connected Google identity is unavailable or does not match the configured account.");
    }
    const accessToken = await refreshGoogleAccessToken(
      { clientId: environment.GOOGLE_CLIENT_ID, clientSecret: environment.GOOGLE_CLIENT_SECRET },
      credential,
      environment.REWIND_TOKEN_ENCRYPTION_KEY,
      oauthStore,
    );
    const calendar = new GoogleCalendarPort({
      accessToken: accessToken.accessToken,
      calendarId: configuration.calendarId,
      expectedEmail: configuration.expectedEmail,
    });
    const state = new PostgresDemoEventStateStore(pool);
    const result = await seedControlledCalendar({ calendar, state, configuration, runId });
    process.stdout.write(`${JSON.stringify({ operation: "seed", ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "failed", operation: "seed", code: safeDemoCommandFailureCode(error) })}\n`);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void main();
}
