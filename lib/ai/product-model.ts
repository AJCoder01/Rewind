import type { ModelProposalPort } from "@/lib/ai/model";
import { OllamaChatClient } from "@/lib/ai/ollama-chat";
import { OllamaModelPort } from "@/lib/ai/ollama-model";
import { OpenAIModelPort } from "@/lib/ai/openai-model";
import { OpenAIResponsesClient } from "@/lib/ai/openai-responses";
import type { ApplicationEnvironment } from "@/lib/config/environment";

export type ProductModelSelection =
  | Readonly<{ runtime: "local_ollama"; provider: "ollama"; model: string; transport: "loopback" }>
  | Readonly<{ runtime: "openai_responses"; provider: "openai"; model: string; transport: "external" }>;

export type ProductModelDependencies = Readonly<{
  ollamaClient?: Pick<OllamaChatClient, "createStructured">;
  openAiClient?: Pick<OpenAIResponsesClient, "createStructured">;
}>;

/**
 * Resolve only the explicit product selector from validated configuration.
 * The historical S043 selector is deliberately absent from this boundary.
 */
export function productModelSelection(environment: ApplicationEnvironment): ProductModelSelection {
  if (environment.REWIND_MODEL_RUNTIME === "local_ollama") {
    if (!environment.REWIND_LOCAL_MODEL) throw new Error("The local product model is not configured.");
    return {
      runtime: "local_ollama",
      provider: "ollama",
      model: environment.REWIND_LOCAL_MODEL,
      transport: "loopback",
    };
  }
  if (environment.REWIND_MODEL_RUNTIME === "openai_responses") {
    if (!environment.OPENAI_API_KEY || !environment.OPENAI_MODEL) {
      throw new Error("The OpenAI product model is not configured.");
    }
    return {
      runtime: "openai_responses",
      provider: "openai",
      model: environment.OPENAI_MODEL,
      transport: "external",
    };
  }
  throw new Error("The product model runtime is not explicitly configured.");
}

export function createProductModel(
  environment: ApplicationEnvironment,
  dependencies: ProductModelDependencies = {},
): ModelProposalPort {
  const selection = productModelSelection(environment);
  if (selection.runtime === "local_ollama") {
    return new OllamaModelPort({
      client: dependencies.ollamaClient ?? new OllamaChatClient(),
      model: selection.model,
    });
  }
  if (!environment.OPENAI_API_KEY) throw new Error("The OpenAI product model is not configured.");
  return new OpenAIModelPort({
    client: dependencies.openAiClient ?? new OpenAIResponsesClient({ apiKey: environment.OPENAI_API_KEY }),
    model: selection.model,
  });
}
