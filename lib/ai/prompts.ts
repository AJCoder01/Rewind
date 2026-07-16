import type { ModelRetryContext } from "@/lib/ai/model";

export const MODEL_PROMPT_VERSION = "controlled-provider-spike.v1" as const;

const BASE_INSTRUCTION =
  "Return only one JSON object matching the supplied strict schema. Use only the supplied IDs, action keys, outcomes, templates, and source values. Do not include code, provider fields, recipients, headers, times, ETags, or extra properties.";

export function buildModelPrompt(
  operation: "initial" | "recovery" | "prevention_rule",
  input: unknown,
  trustedFacts: unknown,
  retryContext?: ModelRetryContext,
): Readonly<{ developer: string; user: string }> {
  const retry = retryContext
    ? ` A previous attempt failed ${retryContext.reason}; correct only these validation locations: ${JSON.stringify(retryContext.issues)}.`
    : "";
  return {
    developer: `${BASE_INSTRUCTION} This is a synthetic, non-effecting ${operation} provider spike.${retry}`,
    user: JSON.stringify({ operation, suppliedInput: input, trustedDeterministicFacts: trustedFacts }),
  };
}
