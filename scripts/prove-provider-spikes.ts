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
import { OllamaChatClient } from "@/lib/ai/ollama-chat";
import { OllamaModelPort } from "@/lib/ai/ollama-model";
import {
  MODEL_SAFETY_INITIAL_CONTEXT,
  MODEL_SAFETY_INITIAL_INPUT,
  MODEL_SAFETY_PREVENTION_CONTEXT,
  MODEL_SAFETY_PREVENTION_INPUT,
  MODEL_SAFETY_RECOVERY_CONTEXT,
  MODEL_SAFETY_RECOVERY_INPUT,
} from "@/tests/fixtures/model-safety";
import type { ModelMetadata } from "@/lib/contracts/provider-ports";
import type { ModelProposalPort } from "@/lib/ai/model";
import { PROVIDER_SPIKE_CONTRACT_VERSION, ProviderSpikeReportSchema } from "@/lib/contracts/provider-spike";
import {
  assertProviderSpikeExecutionDisabled,
  providerSpikeConfirmationPhrase,
  providerSpikeModelRuntime,
  providerSpikeTargetFingerprint,
  runControlledCalendarProviderSpike,
  ProviderSpikeFailureError,
  runControlledProviderModelSpikePhases,
  safeProviderSpikeFailureCode,
  type ProviderSpikeModelRuntime,
} from "@/lib/services/provider-spike";
import { assertTtyGatedDemoEnvironment, calendarDemoConfigurationFromEnvironment } from "@/lib/services/calendar-demo-command";

function modelSummary(
  result: Readonly<{ metadata: ModelMetadata; attempts: number }>,
  runtime: ProviderSpikeModelRuntime,
) {
  if (result.metadata.provider !== runtime.provider || !result.metadata.responseId) {
    throw new ProviderSpikeFailureError("model_metadata_incomplete");
  }
  return {
    status: "validated" as const,
    provider: runtime.provider,
    schemaVersion: result.metadata.schemaVersion,
    attempts: result.attempts,
    model: result.metadata.model,
    receiptFingerprint: sha256Text(result.metadata.responseId).slice(0, 23),
  };
}

export function createProviderSpikeModel(
  runtime: ProviderSpikeModelRuntime,
  options: Readonly<{ openAiApiKey?: string }> = {},
): ModelProposalPort {
  if (runtime.runtime === "local_ollama") {
    return new OllamaModelPort({ client: new OllamaChatClient(), model: runtime.model });
  }
  if (!options.openAiApiKey) throw new ProviderSpikeFailureError("model_runtime_invalid");
  return new OpenAIModelPort({ client: new OpenAIResponsesClient({ apiKey: options.openAiApiKey }), model: runtime.model });
}

export async function runSyntheticProviderModelProof(
  model: ModelProposalPort,
  runtime: ProviderSpikeModelRuntime,
): Promise<Readonly<{
  runtime: ProviderSpikeModelRuntime["runtime"];
  evidenceClass: ProviderSpikeModelRuntime["evidenceClass"];
  operations: readonly [
    Readonly<{ operation: "initial" }> & ReturnType<typeof modelSummary>,
    Readonly<{ operation: "recovery" }> & ReturnType<typeof modelSummary>,
    Readonly<{ operation: "prevention_rule" }> & ReturnType<typeof modelSummary>,
  ];
}>> {
  const initial = modelSummary(await requestValidatedInitialProposal(model, MODEL_SAFETY_INITIAL_INPUT, MODEL_SAFETY_INITIAL_CONTEXT), runtime);
  const recoveryResult = await requestValidatedRecoveryProposal(model, MODEL_SAFETY_RECOVERY_INPUT, MODEL_SAFETY_RECOVERY_CONTEXT);
  const recovery = { operation: "recovery" as const, ...modelSummary(recoveryResult, runtime) };
  const preventionResult = await requestValidatedPreventionRuleProposal(model, MODEL_SAFETY_PREVENTION_INPUT, MODEL_SAFETY_PREVENTION_CONTEXT);
  const prevention = { operation: "prevention_rule" as const, ...modelSummary(preventionResult, runtime) };
  return {
    runtime: runtime.runtime,
    evidenceClass: runtime.evidenceClass,
    operations: [{ operation: "initial" as const, ...initial }, recovery, prevention],
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
    const modelRuntime = providerSpikeModelRuntime(process.env, environment.OPENAI_MODEL);
    const runId = createOpaqueId("run_s043_");
    const fingerprint = providerSpikeTargetFingerprint(configuration.calendarId, databaseUrl, modelRuntime);
    const confirmation = providerSpikeConfirmationPhrase(runId, configuration.calendarId, modelRuntime);
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await readline.question(
      `S043 will run one stale Calendar precondition check, one controlled Calendar move/restore, and three synthetic strict ${modelRuntime.runtime} model calls (target fingerprint ${fingerprint}). Type "${confirmation}" to continue: `,
    );
    readline.close();
    if (answer.trim() !== confirmation) {
      process.stdout.write('{"status":"cancelled","operation":"provider_model_spikes"}\n');
      return;
    }

    const spike = await runControlledProviderModelSpikePhases({
      runModel: async () => {
        const model = createProviderSpikeModel(modelRuntime, { openAiApiKey: environment.OPENAI_API_KEY });
        return runSyntheticProviderModelProof(model, modelRuntime);
      },
      runCalendar: async () => {
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
        return runControlledCalendarProviderSpike({ calendar, state, configuration, runId });
      },
    });

    const report = ProviderSpikeReportSchema.parse({
      status: "ok",
      operation: "provider_model_spikes",
      contractVersion: PROVIDER_SPIKE_CONTRACT_VERSION,
      calendar: spike.calendar,
      model: spike.model,
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
