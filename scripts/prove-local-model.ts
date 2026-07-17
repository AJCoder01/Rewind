import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LOCAL_MODEL_SPIKE_CONTRACT_VERSION,
  LocalModelSpikeReportSchema,
} from "@/lib/contracts/provider-spike";
import { createProductModel, productModelSelection } from "@/lib/ai/product-model";
import { loadApplicationEnvironment, type ApplicationEnvironment } from "@/lib/config/environment";
import {
  ProviderSpikeFailureError,
  safeProviderSpikeFailureCode,
  type ProviderSpikeModelRuntime,
} from "@/lib/services/provider-spike";
import { runSyntheticProviderModelProof } from "@/scripts/prove-provider-spikes";
import { ModelSafetyError } from "@/lib/ai/model-safety";
import { loadPrivateLocalEnvironment } from "@/lib/db/config";

export function productLocalProofRuntime(environment: ApplicationEnvironment): ProviderSpikeModelRuntime {
  const selection = productModelSelection(environment);
  if (selection.runtime !== "local_ollama") {
    throw new ProviderSpikeFailureError("model_runtime_invalid");
  }
  return {
    runtime: selection.runtime,
    evidenceClass: "local_model",
    provider: selection.provider,
    model: selection.model,
  };
}

async function main(): Promise<void> {
  try {
    loadPrivateLocalEnvironment();
    const environment = loadApplicationEnvironment();
    const runtime = productLocalProofRuntime(environment);
    const model = createProductModel(environment);
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
