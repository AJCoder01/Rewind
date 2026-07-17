# OpenAI-to-Ollama runtime audit — 2026-07-17

## Scope and safety

This audit reviewed the complete application model-selection path, standalone commands, dashboard status projection, fixture environments, CI, canonical documentation, and requirement traceability after the mid-project switch to local Ollama. It ran no Calendar mutation, Gmail send, OAuth flow, product execution, reset, provider spike, or database migration. The only real model operation was the documented loopback-only `prove:model-local` checkpoint. Database verification used read-only checks and rollback-only constraint probes.

No credential, OAuth token, database URL, Calendar ID, recipient address, prompt, model output, provider response, or message identifier is recorded here.

## Defects found and corrected

1. PostgreSQL product configuration could omit `REWIND_MODEL_RUNTIME` and silently fall back through the historical S043 selector or OpenAI fields. Product configuration now requires an explicit selector and fails closed on omission.
2. The product planner independently reimplemented provider precedence. A single `productModelSelection`/`createProductModel` boundary now constructs only the explicitly selected adapter.
3. The dashboard independently guessed OpenAI from stale fields. It now reports only the explicit product selector and labels configuration separately from reachability/evidence.
4. `prove:model-local` forced S043 local mode and could pass while the product selected another provider. It now loads the same effective environment as Next, requires product `local_ollama`, uses the exact configured product model, and exercises the product model factory.
5. `prove:provider-spikes` defaulted omission to OpenAI and defaulted the local model name. Its independent S043 selector and exact local model are now mandatory; the TTY prompt states three operations and up to six provider requests if bounded retries are needed.
6. Standalone commands loaded fewer environment files than Next. They now use `@next/env` precedence, covered by synthetic precedence and shell-override tests.
7. Fixture E2E and fake-production environments contained unused OpenAI-looking values. They were removed, and browser/unit assertions require fixture mode to show `Not selected`.
8. Ollama receipt identity omitted the generated output bytes. The receipt hash now binds model, timestamp, prompt/schema versions, token/duration metadata, and exact structured output content without storing that content.
9. CI lacked a zero-credit provider-selection gate. `verify:zero-credit-runtime` now proves explicit local product selection remains loopback Ollama with zero external calls even when synthetic stale OpenAI fields and a differing historical selector are present. CI also runs traceability, G2 evidence closure, and the deterministic model-safety evaluation.
10. Current guides and canonical contracts confused configured runtime, historical model evidence, and current reachability. They now document selector isolation, the exact local proof, optional funded OpenAI behavior, and the fact that Vercel cannot reach Ollama on a developer laptop through loopback.

## Verification completed

- `npm run lint` — passed.
- `npm run typecheck` — passed after correcting the new config-summary type boundary.
- `npm test` — 70 files and 476 tests passed.
- `npm run build` — production build passed.
- `npm run test:e2e` — fixture browser flow passed, including `Not selected` model runtime and fixture-mode assertions.
- `npm run security:scan` — passed with no findings.
- `npm audit --audit-level=moderate` — zero vulnerabilities.
- `npm run traceability:check` — passed for 52 requirements.
- `npm run verify:g1-interface` — passed.
- `npm run verify:g2-closure` — historical G2 evidence passed with all six risks green; its fixed local-model field is explicitly historical, not a current selector.
- `npm run verify:fake-production` — passed.
- `npm run verify:zero-credit-runtime` — passed with `local_ollama`, provider `ollama`, transport `loopback`, and zero external calls.
- `npm run eval:model-safety` — eight checks passed, two-attempt ceiling, zero unsafe adapter calls, zero live provider calls, and no external effects.
- `npm run config:check` — passed; product runtime is `local_ollama`; historical S043 runtime is intentionally not stored.
- `npm run db:verify` — all restricted runtime identity/TLS/catalog/privilege/readiness and rollback-only constraint checks passed.
- `npm run prove:model-local` — the exact configured product model completed initial, recovery, and prevention-rule operations in one attempt each; receipt contract `local-model-spike.v1`; external effects false.

## Remaining honest limits

- S058 has not been run by this audit. The real artifact → Calendar → Gmail product effect remains a separate human-approved gate.
- Loopback Ollama is zero-credit only when the application and Ollama run on the same machine or same self-managed host. A normal Vercel function cannot reach Ollama running on a developer laptop.
- The optional OpenAI adapter remains implemented and tested with deterministic HTTP fakes. It can make paid API calls only when `REWIND_MODEL_RUNTIME=openai_responses` is explicitly configured with funded credentials.
- The dashboard status endpoint checks safe prerequisites only. It deliberately does not call a model or Calendar; `prove:model-local` and the human Calendar preflight are separate evidence.
- The historical S043 selector may remain `not_configured` during normal product use. Its guide supplies the selector inline if that TTY-gated admin proof is deliberately rerun.
- `npm run eval:recovery` remains intentionally unavailable and exits nonzero until the Phase 4 recovery planner and 25-paraphrase fixture tasks are implemented. S058 does not depend on it; this audit did not weaken the gate or misreport the placeholder as passing.

## Result

Passed. No unresolved OpenAI-to-Ollama selector fallback, fixture-provider masquerade, or zero-credit transport ambiguity remains in the implemented S001–S057/pre-S058 scope. S058 remains the next task.
