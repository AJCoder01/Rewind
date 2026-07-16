# S043 zero-cost local model runtime

## Scope

- Task: `S043` controlled provider/model spikes, still in progress
- Requirements: SAFE-08, SAFE-10, NFR-04, NFR-10
- Contract/prompt versions: `provider-spike.v2`, `local-model-spike.v1`, `controlled-provider-spike.v2`, `initial-reasoning.v1`, `recovery-proposal.v1`, `prevention-rule-proposal.v1`
- Migration changes: none

## Decision and boundary

The OpenAI project has zero API credit and the user explicitly declined paid API usage. Rewind therefore adds a real local Ollama runtime rather than converting fixture output into a false live success. OpenAI Responses remains implemented and optional. Local evidence is always labeled `runtime: local_ollama`, `evidenceClass: local_model`, and `provider: ollama`.

The local boundary:

- calls only `http://127.0.0.1:11434/api/chat`;
- rejects models ending in `:cloud`;
- sends no credential and uses temperature zero;
- uses Ollama native JSON Schema output;
- strips only unsupported string-length grammar keywords while retaining closed objects, enums, array cardinality, and numeric bounds;
- applies the complete operation Zod schema and S042 semantic validator after generation; and
- keeps the complete model path to two calls, with no deterministic fallback.

## No-effect real-model proof

`npm run prove:model-local` passed with the already-installed `qwen2.5-coder:latest` model:

```json
{"status":"ok","operation":"local_model_spike","contractVersion":"local-model-spike.v1","model":{"runtime":"local_ollama","evidenceClass":"local_model","operations":[{"operation":"initial","status":"validated","provider":"ollama","schemaVersion":"initial-reasoning.v1","attempts":1,"model":"qwen2.5-coder:latest","receiptFingerprint":"sha256:6119603a4861cd7b"},{"operation":"recovery","status":"validated","provider":"ollama","schemaVersion":"recovery-proposal.v1","attempts":1,"model":"qwen2.5-coder:latest","receiptFingerprint":"sha256:3d93e91a70fcd204"},{"operation":"prevention_rule","status":"validated","provider":"ollama","schemaVersion":"prevention-rule-proposal.v1","attempts":1,"model":"qwen2.5-coder:latest","receiptFingerprint":"sha256:7289f21af69a7f52"}]},"externalEffects":false}
```

The proof used synthetic closed-universe inputs. It made no OpenAI, Google, database, Gmail, Calendar, product execution, or reset call. It is real local-model evidence, not external OpenAI evidence.

## Verification

The following passed:

```text
npm run prove:model-local
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

- Unit/contract suite: 51 files and 343 tests passed.
- Production build and critical fixture browser flow passed.
- Model-safety evaluation: 8 checks passed, maximum two attempts, zero unsafe adapter calls, zero live-provider calls, and no external effects.
- Traceability: 52 requirements, 3 covered, 28 partial, and 21 planned.
- Security scan and production fake-provider guard passed; dependency audit found zero vulnerabilities.
- The real local proof passed all three strict model operations. No live Google or paid model command was run by Codex.

## Remaining checkpoint

S043 remains open until a human runs the combined TTY command with `REWIND_S043_MODEL_RUNTIME=local_ollama` and returns its final sanitized `provider-spike.v2` JSON. The command runs all three local model operations before opening Calendar; the only external effects remain the controlled Calendar move and restore.

References: [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [Ollama local authentication boundary](https://docs.ollama.com/api/authentication), and [OpenAI/ChatGPT usage-control separation](https://learn.chatgpt.com/docs/enterprise/governance#related-chatgpt-usage-controls).
