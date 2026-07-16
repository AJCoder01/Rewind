# S043 model transport and spike-order correction

## Scope

- Task: `S043` controlled provider/model spikes, still in progress
- Requirements: SAFE-05, SAFE-08, SAFE-10, NFR-03, NFR-04, NFR-10
- Contract versions: `provider-spike.v1`, `calendar-demo.v1`, `initial-reasoning.v1`, `recovery-proposal.v1`, `prevention-rule-proposal.v1`
- Migration changes: none

## Human live evidence received

- The separate TTY Calendar preflight returned `status: ok`, `candidateCount: 2`, `baselineCount: 2`, and `expectedVersionCount: 2`.
- Three combined human attempts before the correction failed closed with sanitized codes: `failed_safely`, `model_initial_invalid_output`, and `model_initial_unavailable`.
- The latter two attempts reached the initial model phase only after the old command completed its Calendar phase. Those reversible Calendar operations returned to baseline but do not count as final combined evidence because the report was not emitted.
- No Gmail message, product execution, product reset, seed, deployment, migration, or live provider command was run by Codex.

## Root cause in code

The reported `unavailable` category was not sufficiently specific to identify the external failure. `OpenAIResponsesClient` collapsed every non-2xx status and local timeout into `unavailable`, retried deterministic client/auth failures, and allowed its own two-attempt loop to nest under the S042 two-attempt model-safety loop. One logical operation could therefore issue four HTTP requests. The combined spike also performed Calendar move/restore before checking model readiness.

Official OpenAI documentation confirms the selected `gpt-5.6-sol` model, Responses API, `reasoning.effort: low`, `store: false`, and strict `text.format` JSON Schema request shape are supported. The fix therefore preserves the configured model and request contract.

## Correction

- Added safe, body-free classifications for invalid request, unauthorized, forbidden, missing model, rate limit, timeout, transient unavailability, refusal, truncation, and invalid output.
- Deterministic HTTP/configuration/fallback failures stop after one request.
- `OpenAIModelPort` gives the raw client one request per outer S042 attempt, preserving the complete two-call maximum.
- Increased the bounded per-call timeout from 30 seconds to 90 seconds for GPT-5.6 first-schema and safeguard latency.
- Moved all three non-effecting model proofs before the Calendar mutation phase.
- Added regression tests proving transport classification, timeout behavior, attempt counts, safe redaction, phase order, and zero Calendar calls on model failure.

## Verification

Focused verification passed:

```text
npm run typecheck
npm test -- --run tests/unit/openai-responses.test.ts tests/unit/openai-model.test.ts tests/unit/model-safety.test.ts tests/unit/provider-spike.test.ts
npm run lint
```

Result: 4 focused test files and 40 tests passed.

Full verification also passed:

```text
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
npm run eval:model-safety
npm run traceability:check
npm run security:scan
npm run verify:fake-production
npm audit --audit-level=high
git diff --check
```

- Unit/contract suite: 49 files, 329 tests passed.
- Production build and deterministic browser flow passed.
- Model-safety evaluation: 8 checks passed, maximum model-validation attempts 2, zero unsafe adapter calls, zero live-provider calls, no external effects.
- Traceability: 52 requirements, 3 covered, 28 partial, 21 planned.
- Security scan: 225 tracked files and 677 history blobs, zero findings.
- Fake-production guard passed; dependency audit found zero vulnerabilities.

## Remaining risk and next action

S043 remains incomplete. A human must run the corrected TTY command once and return only its final sanitized JSON. If it fails, the new code will identify the safe transport/configuration class without provider body text and, because the model phase runs first, will perform no Calendar writes.

The first corrected human attempt subsequently identified `model_initial_rate_limited` before Calendar opened. See the [rate-limit blocker report](2026-07-16-s043-openai-rate-limit-blocker.md).

References: [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Responses API migration differences](https://developers.openai.com/api/docs/guides/migrate-to-responses#additional-differences).
