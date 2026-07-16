import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LOCAL_MODEL_SPIKE_CONTRACT_VERSION,
  LocalModelSpikeReportSchema,
} from "@/lib/contracts/provider-spike";
import { providerSpikeModelRuntime, safeProviderSpikeFailureCode } from "@/lib/services/provider-spike";
import { createProviderSpikeModel, runSyntheticProviderModelProof } from "@/scripts/prove-provider-spikes";
import { ModelSafetyError } from "@/lib/ai/model-safety";

async function main(): Promise<void> {
  try {
    const runtime = providerSpikeModelRuntime(
      { ...process.env, REWIND_S043_MODEL_RUNTIME: "local_ollama" },
      "unused-openai-model",
    );
    const model = createProviderSpikeModel(runtime);
    const proof = await runSyntheticProviderModelProof(model, runtime);
    const report = LocalModelSpikeReportSchema.parse({
      status: "ok",
      operation: "local_model_spike",
      contractVersion: LOCAL_MODEL_SPIKE_CONTRACT_VERSION,
      model: proof,
      externalEffects: false,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "failed",
      operation: "local_model_spike",
      code: safeProviderSpikeFailureCode(error),
      ...(error instanceof ModelSafetyError ? { issues: error.issues } : {}),
    })}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void main();
}
