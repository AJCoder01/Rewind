# S043 controlled provider/model spike guide

This is the human-only checkpoint for S043. It runs the low-level Calendar provider proof and three strict model-only calls. It is not a product execution route, approval route, reset route, or recovery route.

## Before running

- Use the `codex/s043-provider-model-spikes` branch in the Rewind workspace.
- Keep the private `.env.local` unchanged. It must already contain the connected, expected Google identity, explicit demo Calendar ID, PostgreSQL runtime URL, recipient allowlist, and configured OpenAI project key/model.
- Run `npm run db:verify` first. Do not paste its connection details or any environment values into chat.
- Confirm the two S035 controlled events are already seeded and the S035 preflight is recorded. Do not run `seed:demo` again.
- Do not enable `REWIND_PRODUCT_EXECUTION_ENABLED` or `REWIND_PRODUCT_RESET_ENABLED`. Do not run `reset:demo` or any product execution action during this checkpoint.

No new credentials, OAuth consent, Google Cloud console change, OpenAI project change, database migration, or deployment is required. The existing private OAuth credential is refreshed by the command; its access token is never printed or persisted.

## Run the Calendar and model spike

In a normal interactive terminal at the repository root, run:

```text
LIVE_INTEGRATION_TESTS=1 npm run prove:provider-spikes
```

The private prompt repeats the exact configured Calendar ID and a target fingerprint. Type the full confirmation phrase only after checking that the Calendar target is the intended controlled account. Any other input cancels before OAuth refresh, database state changes, provider calls, or model calls.

The command then:

1. Reads and validates exactly two tagged, owned, timed, non-recurring events and two persisted rolling versions.
2. Sends one deliberately stale `If-Match` Calendar patch for the US candidate; Google must return a provider conflict and the event must remain unchanged.
3. Moves the UK candidate by one hour with `sendUpdates=none`, verifies the after-state, and restores the recorded move exactly once.
4. Runs initial, recovery, and prevention-rule strict Structured Outputs using synthetic fixture data only, then passes each result through the S042 semantic validator.

The Calendar move and restore are the only external effects in this command. The stale US request is intended to produce no Calendar mutation. Model calls have no external effect and use `store: false`.

Do not rerun the command after a timeout or uncertain provider result. Stop and report the sanitized failure code; a Calendar `uncertain` outcome requires review before any further action.

## Gmail evidence

The one allowlisted Gmail success and no-redispatch replay are already closed by the human S038 proof. Do not send a second message for S043. Link [the S038 live-proof report](../artifacts/test-runs/2026-07-16-s038-gmail-live-proof.md) when recording S043 evidence.

## Return only sanitized evidence

Paste only the final JSON line from `prove:provider-spikes`, for example:

```json
{
  "status": "ok",
  "operation": "provider_model_spikes",
  "contractVersion": "provider-spike.v1",
  "calendar": {
    "preflightBefore": {"status": "ok", "candidateCount": 2, "baselineCount": 2, "expectedVersionCount": 2},
    "staleConflict": {"status": "conflict", "reason": "provider_conflict"},
    "move": {"status": "succeeded"},
    "restore": {"status": "succeeded"},
    "preflightAfter": {"status": "ok", "candidateCount": 2, "baselineCount": 2, "expectedVersionCount": 2},
    "partialReceiptStatuses": {"uk": ["succeeded", "succeeded"], "us": ["conflict"]}
  },
  "model": {"operations": [
    {"operation": "initial", "status": "validated", "schemaVersion": "initial-reasoning.v1", "attempts": 1, "model": "<configured-model>", "responseIdFingerprint": "sha256:..."},
    {"operation": "recovery", "status": "validated", "schemaVersion": "recovery-proposal.v1", "attempts": 1, "model": "<configured-model>", "responseIdFingerprint": "sha256:..."},
    {"operation": "prevention_rule", "status": "validated", "schemaVersion": "prevention-rule-proposal.v1", "attempts": 1, "model": "<configured-model>", "responseIdFingerprint": "sha256:..."}
  ]},
  "productExecution": "disabled",
  "productReset": "disabled",
  "externalEffects": "calendar_move_restore_only"
}
```

Never paste OAuth tokens, API keys, database URLs, Calendar IDs, attendee addresses, full model prompts/outputs, provider response bodies, or raw message IDs. If the command fails, return only its sanitized `{"status":"failed","operation":"provider_model_spikes","code":"..."}` line.
