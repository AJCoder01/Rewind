# S043 controlled provider/model spike success

## Scope

- Task: `S043` controlled provider/model spikes, complete
- Requirements: SAFE-08, SAFE-10, NFR-04, NFR-10
- Contract versions: `provider-spike.v2`, `calendar-demo.v1`, `initial-reasoning.v1`, `recovery-proposal.v1`, `prevention-rule-proposal.v1`
- Runtime: `local_ollama`
- Evidence class: `local_model`
- External effects: controlled Calendar move/restore only

## Human receipt

The human operator ran the TTY-gated combined provider spike with the explicitly selected loopback Ollama runtime and returned this sanitized final JSON. No credentials, OAuth material, database URLs, Calendar IDs, recipient addresses, prompts, raw model outputs, provider responses, event IDs, message IDs, or ETags are recorded.

```json
{"status":"ok","operation":"provider_model_spikes","contractVersion":"provider-spike.v2","calendar":{"preflightBefore":{"status":"ok","contractVersion":"calendar-demo.v1","candidateCount":2,"baselineCount":2,"expectedVersionCount":2},"staleConflict":{"status":"conflict","reason":"provider_conflict"},"move":{"status":"succeeded"},"restore":{"status":"succeeded"},"preflightAfter":{"status":"ok","contractVersion":"calendar-demo.v1","candidateCount":2,"baselineCount":2,"expectedVersionCount":2},"partialReceiptStatuses":{"uk":["succeeded","succeeded"],"us":["conflict"]}},"model":{"runtime":"local_ollama","evidenceClass":"local_model","operations":[{"operation":"initial","status":"validated","provider":"ollama","schemaVersion":"initial-reasoning.v1","attempts":1,"model":"qwen2.5-coder:latest","receiptFingerprint":"sha256:b4e6ca0c0e5e68e4"},{"operation":"recovery","status":"validated","provider":"ollama","schemaVersion":"recovery-proposal.v1","attempts":1,"model":"qwen2.5-coder:latest","receiptFingerprint":"sha256:972babf08b63d53b"},{"operation":"prevention_rule","status":"validated","provider":"ollama","schemaVersion":"prevention-rule-proposal.v1","attempts":1,"model":"qwen2.5-coder:latest","receiptFingerprint":"sha256:a01645638cdce97f"}]},"productExecution":"disabled","productReset":"disabled","externalEffects":"calendar_move_restore_only"}
```

## Interpretation

- The before and after Calendar preflights each found exactly two candidates, two protected baselines, and two expected rolling versions.
- The deliberate stale Calendar precondition returned `provider_conflict`; the controlled move and restore both succeeded.
- Initial reasoning, recovery, and prevention-rule outputs each passed the strict schema and S042 semantic validation in one attempt.
- The selected evidence is real local Ollama inference, explicitly labeled `local_model`; it is not OpenAI evidence and is not fixture output.
- Product execution and product reset remained disabled. No Gmail send was performed by S043; the separate S038 one-send/replay receipt remains the Gmail evidence.

## Repository verification

The documentation and traceability packet was checked after recording the receipt:

```text
npm run db:verify                         passed; all catalog, privilege, TLS, readiness, and constraint probes true
npm run traceability:check                passed; traceability.v1, 52 requirements, 3 covered, 28 partial, 21 planned
npm test -- --run tests/unit/traceability.test.ts
                                          passed; 4 tests
npm run typecheck                         passed
npm run lint                              passed
npm run security:scan                     passed; 234 files and 730 history blobs, 0 findings
git diff --check                          passed
```

## Verification boundary

This receipt closes the S043 provider/model spike. It does not authorize product execution, reset, recovery, rule activation, or a paid model provider. S044 remains the next task for the honest connection/preflight UI, followed by S045 for the G2 evidence and negative-test closure.
