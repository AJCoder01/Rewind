# S043 OpenAI rate-limit blocker

## Scope

- Task: `S043` controlled provider/model spikes, still in progress
- Contract version: `provider-spike.v1`
- Migration, schema, and fixture changes: none

## Sanitized human evidence

After pulling the model-transport correction, the human ran the TTY-gated combined provider spike once. It failed closed during the initial model operation with `model_initial_rate_limited`.

The corrected command runs all non-effecting model checks before opening the Calendar phase. Therefore this attempt made no Calendar request or mutation. It also made no Gmail request and did not invoke product execution or reset. Codex did not run a live provider command.

## Diagnosis

The safe code proves that the Responses endpoint returned HTTP 429. It does not distinguish request-rate exhaustion from exhausted project/organization quota because the transport intentionally does not read, persist, log, or return provider error bodies.

Official OpenAI guidance documents both HTTP 429 classes:

- Requests sent too quickly require pacing or a suitable rate-limit increase.
- Exhausted credits or maximum monthly spend require billing/credit or usage-limit correction.

The repository cannot repair either account-level condition. Changing the strict schema, prompt, model, Calendar configuration, database, or retry count would not resolve an exhausted provider limit and would weaken the recorded safety boundary.

## Required human checkpoint

1. In the OpenAI Platform organization and project that own the configured private key, inspect Billing and Limits privately.
2. Ensure API billing/credits are active and the organization/project has non-zero remaining spend and model rate limits.
3. If the limit is only a short request-per-minute or token-per-minute window, wait until it resets. Do not repeatedly run the combined spike while investigating.
4. After the limit is available, run the TTY-gated provider spike exactly once and return only its final sanitized JSON line.

Do not paste API keys, billing data, organization/project IDs, prompts, or provider response text into repository evidence or chat.

References: [OpenAI API error codes](https://developers.openai.com/api/docs/guides/error-codes#api-errors), [rate-limit guidance](https://developers.openai.com/cookbook/examples/how_to_handle_rate_limits#default-rate-limits), and [billing-limit guidance](https://developers.openai.com/api/docs/guides/production-best-practices#managing-billing-limits).
