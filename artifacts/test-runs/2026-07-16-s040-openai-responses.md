# S040 — OpenAI Responses client

| Field | Value |
|---|---|
| Task | S040 |
| Date | 2026-07-16 |
| Branch | `codex/s040-openai-responses-client` |
| Status | Passed |
| API boundary | `https://api.openai.com/v1/responses` |
| Live model call | None; S043 owns the human/provider spike |

## Implemented boundary

- Sends the configured model with `store: false` and strict `text.format` JSON Schema output.
- Validates the request schema before transport, including an object root, required keys, and `additionalProperties: false`.
- Extracts only structured output text plus safe response ID/model/usage metadata.
- Maps refusal, incomplete/truncated, malformed output, provider status, transport, and timeout failures to a typed redacted error.
- Adds at most one safe validation retry and never includes raw provider output or refusal text in the retry instruction/error.
- Keeps the API key in the server-only Authorization header; no key, prompt, raw response, or live provider data is logged or returned.

## Verification

- Focused Responses suite: passed — 6 tests.
- Full unit suite: passed — 45 files / 289 tests.
- Typecheck: passed.
- Lint: passed with zero warnings.
- Production build: passed.
- Browser E2E: passed.
- Traceability: passed — 52 requirements, 3 covered, 24 partial, 25 planned.
- Fake-production refusal: passed.
- Security scan: passed — 204 scanned files and 609 reachable history blobs, 0 findings.
- Dependency audit: passed — 0 vulnerabilities.
- No live OpenAI call, credential use, external effect, or production data was used.

S040 is complete. The next sequential task is S041, versioned model-only schemas.
