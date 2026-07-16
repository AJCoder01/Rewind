# S042 — Model safety and evaluation harnesses

| Field | Value |
|---|---|
| Task | S042 |
| Date | 2026-07-16 |
| Branch | `codex/s042-model-safety` |
| Fixture/schema versions | `model-safety.v1`; `initial-reasoning.v1`; `recovery-proposal.v1`; `prevention-rule-proposal.v1`; `provider-ports.v1` |
| Status | Passed |
| Live model/provider calls | None |
| External effects | None |

## Implemented boundary

- Added `lib/ai/model-safety.ts` as the deterministic semantic boundary after S041 shape parsing.
- Initial proposals must match the provider-ranked selected candidate, the selected assumption, the complete artifact/Calendar/mail dependency map, and an independent account brief.
- Recovery proposals require an explicit trusted corrected candidate, all and only succeeded initial actions, compatible `restore`/`correct`/`preserve` outcomes, both fixed new-action templates exactly once, and server-owned recipient expansion.
- Prevention-rule proposals remain bound to the supplied source task and the fixed Acme rule shape.
- Model validation makes at most two attempts, passes only safe machine-readable issue codes/paths to the second attempt, rejects fallback metadata, and has no deterministic success fallback after the second failure.
- Added synthetic fixtures, focused unit tests, and `npm run eval:model-safety`. The existing `npm run eval:recovery` remains intentionally deferred until the later recovery planner and 25-paraphrase fixture set exist.

## Safety/evaluation checks

`npm run eval:model-safety` passed with:

```text
fixtureVersion: model-safety.v1
checkCount: 8
maxModelValidationAttempts: 2
unsafeAdapterCalls: 0
liveProviderCalls: 0
externalEffects: false
```

The harness covers valid initial/recovery/prevention output, malformed output, unknown IDs/templates, recipient-field injection, dependency/selection drift, unsafe preserve, incomplete/duplicate/non-succeeded action decisions, prompt-injection-like context with no explicit target, refusal retry/failure, and no hidden deterministic fallback.

## Verification

- `node --version` / `npm --version`: passed — Node `v24.18.0`, npm `11.16.0`.
- `npm ci`: passed — 440 packages installed; 0 vulnerabilities.
- `npx vitest run tests/unit/model-safety.test.ts tests/unit/model-schemas.test.ts tests/unit/openai-responses.test.ts`: passed — 3 files / 24 tests.
- `npm test`: passed — 47 files / 307 tests.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings after removing one unused helper.
- `npm run eval:model-safety`: passed; no adapter, live model, provider, database, or external-effect call.
- `git diff --check`: passed.
- `npm run build`: passed.
- `npm run test:e2e`: passed — authenticated fixture create/review, expiry, cancel/back, keyboard/reduced-motion/responsive smoke.
- `npm run traceability:check`: passed — 52 records, 3 covered / 28 partial / 21 planned.
- `npm run security:scan`: passed — 212 files / 636 reachable history blobs, 0 findings.
- `npm run verify:fake-production`: passed — production fixture selection rejected.
- `npm audit --audit-level=moderate`: passed — 0 vulnerabilities.
- `git diff --check`: passed.

## Requirement links and remaining risk

- Requirement links: FR-21, FR-22, FR-28, SAFE-08, NFR-04, NFR-05.
- S042 proves deterministic proposal safety and representative negative cases, not live model quality, provider grounding, product recovery execution, or the full 25-paraphrase gate. Those remain S043 and S062–S074/S091 work.
- No credentials, OAuth consent, database migration, provider console action, deployment, live Calendar/Gmail action, or external effect was required.
