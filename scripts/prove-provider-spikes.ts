import { Pool } from "pg";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createOpaqueId } from "@/lib/domain/ids";
import { sha256Text } from "@/lib/domain/digest";
import { loadApplicationEnvironment } from "@/lib/config/environment";
import { loadPrivateLocalEnvironment, requireDatabaseUrl } from "@/lib/db/config";
import { PostgresDemoEventStateStore } from "@/lib/db/demo-event-state";
import { PostgresOAuthStore } from "@/lib/db/oauth-store";
import { refreshGoogleAccessToken } from "@/lib/google/credentials";
import { GoogleCalendarPort } from "@/lib/google/calendar";
import { OpenAIResponsesClient } from "@/lib/ai/openai-responses";
import { requestValidatedInitialProposal, requestValidatedPreventionRuleProposal, requestValidatedRecoveryProposal } from "@/lib/ai/model-safety";
import { OpenAIModelPort } from "@/lib/ai/openai-model";
import {
  MODEL_SAFETY_INITIAL_CONTEXT,
  MODEL_SAFETY_INITIAL_INPUT,
  MODEL_SAFETY_PREVENTION_CONTEXT,
  MODEL_SAFETY_PREVENTION_INPUT,
  MODEL_SAFETY_RECOVERY_CONTEXT,
  MODEL_SAFETY_RECOVERY_INPUT,
} from "@/tests/fixtures/model-safety";
import type { ModelMetadata } from "@/lib/contracts/provider-ports";
import { PROVIDER_SPIKE_CONTRACT_VERSION, ProviderSpikeReportSchema } from "@/lib/contracts/provider-spike";
import {
  assertProviderSpikeExecutionDisabled,
  providerSpikeConfirmationPhrase,
  providerSpikeTargetFingerprint,
  runControlledCalendarProviderSpike,
  ProviderSpikeFailureError,
  safeProviderSpikeFailureCode,
} from "@/lib/services/provider-spike";
import { assertTtyGatedDemoEnvironment, calendarDemoConfigurationFromEnvironment } from "@/lib/services/calendar-demo-command";

function modelSummary(result: Readonly<{ metadata: ModelMetadata; attempts: number }>) {
  if (result.metadata.provider !== "openai" || !result.metadata.responseId) {
    throw new ProviderSpikeFailureError("model_metadata_incomplete");
  }
  return {
    status: "validated" as const,
    schemaVersion: result.metadata.schemaVersion,
    attempts: result.attempts,
    model: result.metadata.model,
    responseIdFingerprint: sha256Text(result.metadata.responseId).slice(0, 23),
  };
}

async function main(): Promise<void> {
  let pool: Pool | undefined;
  try {
    loadPrivateLocalEnvironment();
    assertTtyGatedDemoEnvironment(process.env, {
      stdinIsTTY: process.stdin.isTTY,
      stdoutIsTTY: process.stdout.isTTY,
    });
    assertProviderSpikeExecutionDisabled(process.env);
    const environment = loadApplicationEnvironment();
    const configuration = calendarDemoConfigurationFromEnvironment(environment);
    const databaseUrl = requireDatabaseUrl("DATABASE_URL", { DATABASE_URL: environment.DATABASE_URL });
    const runId = createOpaqueId("run_s043_");
    const fingerprint = providerSpikeTargetFingerprint(configuration.calendarId, databaseUrl);
    const confirmation = providerSpikeConfirmationPhrase(runId, configuration.calendarId);
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await readline.question(
      `S043 will run one stale Calendar precondition check, one controlled Calendar move/restore, and three synthetic strict model calls (target fingerprint ${fingerprint}). Type "${confirmation}" to continue: `,
    );
    readline.close();
    if (answer.trim() !== confirmation) {
      process.stdout.write('{"status":"cancelled","operation":"provider_model_spikes"}\n');
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
      throw new ProviderSpikeFailureError("credential_unavailable");
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
    const calendarResult = await runControlledCalendarProviderSpike({
      calendar,
      state,
      configuration,
      runId,
    });

    const model = new OpenAIModelPort({
      client: new OpenAIResponsesClient({ apiKey: environment.OPENAI_API_KEY }),
      model: environment.OPENAI_MODEL,
    });
    const initial = modelSummary(await requestValidatedInitialProposal(model, MODEL_SAFETY_INITIAL_INPUT, MODEL_SAFETY_INITIAL_CONTEXT));
    const recoveryResult = await requestValidatedRecoveryProposal(model, MODEL_SAFETY_RECOVERY_INPUT, MODEL_SAFETY_RECOVERY_CONTEXT);
    const recovery = {
      operation: "recovery" as const,
      ...modelSummary(recoveryResult),
    };
    const preventionResult = await requestValidatedPreventionRuleProposal(model, MODEL_SAFETY_PREVENTION_INPUT, MODEL_SAFETY_PREVENTION_CONTEXT);
    const prevention = {
      operation: "prevention_rule" as const,
      ...modelSummary(preventionResult),
    };

    const report = ProviderSpikeReportSchema.parse({
      status: "ok",
      operation: "provider_model_spikes",
      contractVersion: PROVIDER_SPIKE_CONTRACT_VERSION,
      calendar: calendarResult,
      model: {
        operations: [
          { operation: "initial", ...initial },
          recovery,
          prevention,
        ],
      },
      productExecution: "disabled",
      productReset: "disabled",
      externalEffects: "calendar_move_restore_only",
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "failed", operation: "provider_model_spikes", code: safeProviderSpikeFailureCode(error) })}\n`);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void main();
}
