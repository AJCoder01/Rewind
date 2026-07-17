# S058 controlled live initial-flow guide

Status: operator guide only. S058 is not complete until the human-controlled run succeeds and a sanitized receipt is recorded.

This guide performs one real approved product flow: persist the exact account brief, conditionally move the controlled Acme UK Calendar event, and send one exact Gmail notification to the controlled UK recipient. The Calendar update and Gmail send are real external effects. Gmail cannot be unsent.

## Non-negotiable boundaries

- Run this only from the local Rewind application against the dedicated demo account, calendar, events, database, and team-controlled recipients.
- Never paste credentials, OAuth tokens, session cookies, CSRF values, database URLs, Calendar IDs, attendee addresses, prompts, mail bodies, or raw provider responses into chat, issues, screenshots, or evidence.
- Do not run S058 from fixture mode. A fixture plan has `modelMetadata.source: fixture`, shows a Fixture mode notice, and has no approval button.
- Do not use an Ollama model ending in `:cloud`. The local runtime is fixed to loopback and rejects cloud-backed aliases.
- Stop immediately on `conflict`, `delivery_uncertain`, `permanently_failed`, identity mismatch, recipient mismatch, an unexpected event, or any partial result. Do not manually retry Gmail or edit database rows.
- Only the authenticated dashboard operator may approve and execute. MCP cannot do either.

## What this run proves—and does not prove

It proves one controlled initial product path with provider-grounded planning, exact dashboard approval, durable artifact/Calendar/Gmail receipts, stale-state refusal, and no duplicate effect on identical HTTP replay.

It does not prove recovery, product reset, production multi-user safety, hosted Ollama, five consecutive live rehearsals, or general-purpose agent safety. Preserve the resulting moved-event state for the later recovery tasks; do not improvise a reset.

## 1. Prepare private configuration

Keep all private values in the existing untracked local environment file. Do not print that file. The product path needs the already-provisioned PostgreSQL and Google settings documented in the earlier private-environment and OAuth guides.

For the zero-credit model path, set these two non-secret selectors:

```text
REWIND_STORAGE_MODE=postgres
REWIND_MODEL_RUNTIME=local_ollama
REWIND_LOCAL_MODEL=qwen2.5-coder:latest
```

`OPENAI_API_KEY` and `OPENAI_MODEL` may be absent in this mode. The configuration validator requires them only when `REWIND_MODEL_RUNTIME=openai_responses` is selected.

Also verify privately that the existing configuration still names:

- the exact expected Google subject and email;
- the dedicated controlled Calendar;
- exactly one UK and one US team-owned recipient;
- `REWIND_DEMO_DATE=2026-08-20`;
- the exact OAuth scopes `openid`, `email`, `calendar.events.owned`, and `gmail.send`; and
- distinct high-entropy session, dashboard, MCP, and token-encryption secrets.

Do not send any of those values to Codex. If a check fails, report only the safe field/code emitted by the application.

## 2. Start and verify the local model

In a normal terminal:

```text
ollama list
npm run prove:model-local
```

Expected result: the selected model is installed and the proof returns a sanitized `local-model-spike.v1` success with three validated operations and `externalEffects: false`.

If Ollama is not running, start the local Ollama application/service and rerun the no-effect proof. Do not switch to a cloud model or fabricate an OpenAI key.

## 3. Run the no-write repository gates

From the repository root:

```text
npm run db:verify
npm run lint
npm run typecheck
npm test
npm run build
npm run security:scan
npm run traceability:check
npm run verify:fake-production
npm run verify:g1-interface
npm run verify:g2-closure
npm run eval:model-safety
npm run config:check
```

Every command must pass. `db:verify` uses rollback-only probes. None of these commands may send Gmail or mutate Calendar.

Run the browser suite separately if it has not just passed on the exact commit:

```text
npm run test:e2e
```

The automated browser suite uses fixture mode and must show no approval button.

## 4. Human-read the controlled Calendar

Run the read-only preflight in a TTY:

```text
npm run preflight:demo
```

Read the confirmation phrase from your own terminal and type it there. Do not copy the phrase or resulting target identifiers into chat.

Continue only if the final sanitized line reports:

- `status: ok`;
- exactly two candidates;
- exactly two baselines; and
- exactly two expected provider versions.

If this preflight fails after an earlier product run, stop. Do not use `seed:demo`, `reset:demo`, Calendar UI edits, or database edits as an improvised repair.

## 5. Start the application

In a terminal that retains the private local environment:

```text
npm run dev
```

Open the local application in the browser and sign in with the private dashboard passcode. Do not expose the passcode in terminal history or screenshots.

On the connection/preflight panel, require all of the following:

- Runtime boundary: live-capable configuration
- Storage: PostgreSQL ready
- Google account: connected identity
- Model evidence: Local Ollama
- Product execution: enabled / workflow ready
- Product reset: disabled

The Calendar check may still say that human-gated preflight has not run from the dashboard. That is expected because the dashboard status endpoint never performs a provider call.

## 6. Create the one supported World PR

Submit exactly this controlled request:

```text
Move the Acme renewal meeting on 2026-08-20 to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees.
```

Planning reads Calendar and calls local Ollama, but performs no external write. Continue only if the review:

- has no Fixture mode notice;
- shows Acme UK selected and Acme US as the visible alternative;
- shows the exact current UK event time and proposed 15:00–15:30 America/New_York time;
- shows the exact expected UK recipient and no US recipient;
- shows the complete canonical account brief and source/hash;
- shows artifact → Calendar → Gmail order;
- shows Calendar and Gmail depending on the Acme-region assumption while the brief does not;
- shows one immutable plan version and digest; and
- provides `Approve exact plan`.

If any target, time, recipient, content, dependency, provider version, or label is unexpected, cancel the unapproved review. Do not approve it.

## 7. Record exact approval

Click `Approve exact plan` once.

Expected result:

- the task becomes `executing`/approved-ready;
- exactly three durable planned action rows exist;
- the timeline says approval was recorded and no external action has started; and
- the button changes to `Execute approved plan`.

Approval itself must not write Calendar, send Gmail, or regenerate the artifact. If an external effect appears before the execution click, stop and record a sanitized failure.

## 8. Execute once

Before clicking, recheck the displayed UK target, time, recipient, and exact content. Then click `Execute approved plan` once and wait for the synchronous response. Do not refresh, close the tab, or stop the server while the request is active.

Expected order:

1. The exact approved account brief is persisted.
2. The UK event is refetched and conditionally moved with its approved ETag; only start/end change and Calendar attendee updates remain disabled.
3. Only after the first two actions succeed, the exact approved UK Gmail message is handed off once.

Expected final dashboard state:

- World PR status `completed`;
- artifact `succeeded` with a typed artifact receipt;
- Calendar `succeeded` with a verified move receipt and a new ETag fingerprint/state;
- Gmail `succeeded` with a sent receipt;
- exactly one attempt for each action; and
- no raw recipients, message body, token, or provider response in the execution timeline.

If Calendar becomes stale before the first action, Rewind should execute nothing, invalidate the old approval, and show a fresh unapproved plan version. Review and approve that new version only after verifying every field again.

If any action stops after execution has begun, do not click resume until the durable receipt clearly marks only a known-safe retryable pre-handoff failure. Never resume a Calendar conflict or Gmail uncertain/permanent outcome.

## 9. Prove identical replay does not duplicate effects

Keep browser developer tools local; never copy request headers or cookies out of the browser.

1. Open the browser Network panel before the execution click, or locate the completed `POST .../execution` request afterward.
2. Record the visible controlled Calendar event's final time and verify the controlled recipient received exactly one new message.
3. Right-click the completed execution request and use the browser's replay/resend function. This reuses the same session, CSRF value, request body, and idempotency key inside the browser.
4. Require another `200` completed response.
5. Refresh the review. The three action attempts must remain `1`, the Calendar state/version must not change again, and the recipient must still have exactly one new message.

If your browser does not offer safe request replay, stop after the successful first execution and record replay as not human-verified. Do not extract cookies or build a command containing them. Automated concurrency/replay tests remain evidence, but S058 should not claim a live replay that was not performed.

## 10. Record only sanitized evidence

Do not paste the route response because it contains opaque resource and plan identifiers. Record a hand-authored summary containing only closed status labels, for example:

```json
{"status":"ok","operation":"s058_controlled_initial_flow","modelRuntime":"local_ollama","artifact":"succeeded","calendar":"succeeded","gmail":"succeeded","attempts":{"artifact":1,"calendar":1,"gmail":1},"replay":"no_duplicate_effect","fixtureSubstitution":false,"productReset":"disabled"}
```

Before saving evidence, scan it for addresses, IDs, URLs, tokens, cookies, prompts, bodies, provider response text, and screenshots containing private values.

## 11. After the run

- Leave the successful initial state intact for S059 and the later recovery flow.
- Do not rerun S058 as a second initial task: the scenario lock and changed Calendar state are intentional.
- Do not manually restore the Calendar or delete the sent email.
- Keep product reset disabled until its planned tasks are implemented and approved.
- If a partial/uncertain outcome occurred, preserve the database and provider state and report only the sanitized status/error code. That state needs a code-level reconciliation decision, not manual cleanup.
