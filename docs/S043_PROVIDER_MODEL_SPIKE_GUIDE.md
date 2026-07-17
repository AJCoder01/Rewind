# S043 controlled provider/model spike guide

This is the human-only checkpoint for S043. It runs the low-level Calendar provider proof and three strict model operations. Each operation has a maximum of two attempts, so an explicitly funded OpenAI run can make up to six provider requests. It is not a product execution route, approval route, reset route, or recovery route.

## Before running

- Use the `codex/s043-provider-model-spikes` branch in the Rewind workspace.
- Keep the private `.env.local` credentials unchanged. It must already contain the connected, expected Google identity, explicit demo Calendar ID, PostgreSQL runtime URL, recipient allowlist, and explicit product runtime. The command below supplies the independent S043 runtime inline. OpenAI fields are optional and are not called in local mode.
- Install and start Ollama locally. `qwen2.5-coder:latest` is the verified local model. Confirm the exact configured `REWIND_LOCAL_MODEL` appears in `ollama list`; do not select any model ending in `:cloud`.
- Run `npm run db:verify` first. Do not paste its connection details or any environment values into chat.
- Confirm the two S035 controlled events are already seeded and the S035 preflight is recorded. Do not run `seed:demo` again.
- Do not enable `REWIND_PRODUCT_EXECUTION_ENABLED` or `REWIND_PRODUCT_RESET_ENABLED`. Do not run `reset:demo` or any product execution action during this checkpoint.

No new credential, OAuth consent, Google Cloud/OpenAI console change, database migration, deployment, or paid API balance is required. Local model prompts stay on `127.0.0.1`; the existing private Google OAuth credential is refreshed only after the local model phase succeeds.

First run the no-effect local proof:

```text
npm run prove:model-local
```

It must return `status: ok`, `operation: local_model_spike`, `runtime: local_ollama`, `evidenceClass: local_model`, and `externalEffects: false`. This command is bound to the product selector `REWIND_MODEL_RUNTIME=local_ollama` and the exact configured `REWIND_LOCAL_MODEL`; it does not force a separate hidden default. This is real local inference, not fixture output and not OpenAI evidence.

## Run the Calendar and model spike

In a normal interactive terminal at the repository root, run:

```text
REWIND_S043_MODEL_RUNTIME=local_ollama LIVE_INTEGRATION_TESTS=1 npm run prove:provider-spikes
```

The private prompt repeats the exact configured Calendar ID, selected local runtime/model, and a target fingerprint. Type the full confirmation phrase only after checking both the Calendar target and `MODEL LOCAL_OLLAMA qwen2.5-coder:latest`. Any other input cancels before OAuth refresh, database state changes, Calendar calls, or model calls.

The command then:

1. Runs initial, recovery, and prevention-rule strict Structured Outputs using synthetic fixture data only, then passes each result through the S042 semantic validator.
2. Only after all three model proofs pass, reads and validates exactly two tagged, owned, timed, non-recurring events and two persisted rolling versions.
3. Sends one deliberately stale `If-Match` Calendar patch for the US candidate; Google must return a provider conflict and the event must remain unchanged.
4. Moves the UK candidate by one hour with `sendUpdates=none`, verifies the after-state, and restores the recorded move exactly once.

The Calendar move and restore are the only external effects in this command. The stale US request is intended to produce no Calendar mutation. Local model operations have no external or paid-provider effect and use the fixed loopback Ollama endpoint. S043 fails closed if `REWIND_S043_MODEL_RUNTIME` is omitted. OpenAI mode remains available only with explicit `REWIND_S043_MODEL_RUNTIME=openai_responses`, valid funded credentials, and the matching TTY confirmation; it is not used for the zero-spend path and may make up to six Responses requests.

Do not rerun the command after a timeout or uncertain provider result. Stop and report the sanitized failure code; a Calendar `uncertain` outcome requires review before any further action. Known safe diagnostic codes include `credential_unavailable`, `oauth_*`, `provider_unavailable`, `preflight_failed`, and `model_<operation>_<kind>`. Model kinds distinguish `invalid_request`, `unauthorized`, `forbidden`, `not_found`, `rate_limited`, `timeout`, `unavailable`, `refusal`, `truncated`, and `invalid_output`; they never contain provider text. Deterministic request/auth/permission/model-lookup failures are not retried. A model failure occurs before any Calendar mutation.

For `model_*_rate_limited` in OpenAI mode, stop rather than repeatedly rerunning the combined spike. The zero-spend resolution is to use the explicit local command above, not to label OpenAI as successful.

## Gmail evidence

The one allowlisted Gmail success and no-redispatch replay are already closed by the human S038 proof. Do not send a second message for S043. Link [the S038 live-proof report](../artifacts/test-runs/2026-07-16-s038-gmail-live-proof.md) when recording S043 evidence.

## Return only sanitized evidence

Paste only the final JSON line from `prove:provider-spikes`, for example:

```json
{
  "status": "ok",
  "operation": "provider_model_spikes",
  "contractVersion": "provider-spike.v2",
  "calendar": {
    "preflightBefore": {"status": "ok", "candidateCount": 2, "baselineCount": 2, "expectedVersionCount": 2},
    "staleConflict": {"status": "conflict", "reason": "provider_conflict"},
    "move": {"status": "succeeded"},
    "restore": {"status": "succeeded"},
    "preflightAfter": {"status": "ok", "candidateCount": 2, "baselineCount": 2, "expectedVersionCount": 2},
    "partialReceiptStatuses": {"uk": ["succeeded", "succeeded"], "us": ["conflict"]}
  },
  "model": {"runtime": "local_ollama", "evidenceClass": "local_model", "operations": [
    {"operation": "initial", "status": "validated", "provider": "ollama", "schemaVersion": "initial-reasoning.v1", "attempts": 1, "model": "qwen2.5-coder:latest", "receiptFingerprint": "sha256:..."},
    {"operation": "recovery", "status": "validated", "provider": "ollama", "schemaVersion": "recovery-proposal.v1", "attempts": 1, "model": "qwen2.5-coder:latest", "receiptFingerprint": "sha256:..."},
    {"operation": "prevention_rule", "status": "validated", "provider": "ollama", "schemaVersion": "prevention-rule-proposal.v1", "attempts": 1, "model": "qwen2.5-coder:latest", "receiptFingerprint": "sha256:..."}
  ]},
  "productExecution": "disabled",
  "productReset": "disabled",
  "externalEffects": "calendar_move_restore_only"
}
```

Never paste OAuth tokens, API keys, database URLs, Calendar IDs, attendee addresses, full model prompts/outputs, provider response bodies, or raw message IDs. If the command fails, return only its sanitized `{"status":"failed","operation":"provider_model_spikes","code":"..."}` line.
