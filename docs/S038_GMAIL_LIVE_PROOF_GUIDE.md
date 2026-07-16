# S038 controlled Gmail live-proof guide

This is the single human-only checkpoint for S038. The command sends one real message to the configured UK allowlist recipient, persists the exact receipt and unique `(plan_id, action_key)` replay identity, then replays the same action and proves no second Gmail transport call occurs.

## Before running

- Use the current `codex/s038-gmail-live-proof` branch in the shared Rewind workspace.
- Keep `.env.local` private and unchanged. It must already contain the connected Google/OAuth, PostgreSQL, and structured recipient-allowlist configuration used by S035.
- Confirm `npm run db:verify` is green. Codex completed this check immediately before preparing S038.
- Do not run the command in CI or Production. Do not change the allowlist merely to make the proof pass.
- Expect exactly one real email in the configured UK team-controlled inbox. Sent mail remains and is not removed by reset.

## Run the proof

In a normal interactive terminal opened at the Rewind repository, run:

```text
LIVE_INTEGRATION_TESTS=1 npm run prove:gmail
```

The command prints a private prompt naming the exact recipient and a generated run ID. Copy the entire quoted confirmation phrase exactly and press Enter. If the literal recipient is unexpected, press Ctrl-C or enter anything else; the command will cancel without sending.

Do not paste the recipient, OAuth values, database URL, access token, or full email content into chat. Paste only the final JSON result. A successful result has this safe shape:

```json
{
  "status": "ok",
  "operation": "gmail_live_proof",
  "runId": "run_s038_...",
  "firstStatus": "sent",
  "replayStatus": "sent",
  "replayVerified": true,
  "attempts": 1,
  "recipientFingerprint": "sha256:...",
  "messageIdFingerprint": "sha256:..."
}
```

Then check the configured UK inbox manually and confirm that exactly one message with the displayed run ID arrived. Do not run the command again to troubleshoot an uncertain result: the command and durable action state fail closed, but any `delivery_uncertain` outcome requires review rather than resend.

## Safety behavior

- Missing TTY, missing `LIVE_INTEGRATION_TESTS=1`, CI, Production, fixture storage, sender/recipient mismatch, or an unallowlisted target fails before Gmail dispatch.
- The command stores the immutable proof plan and action row before token refresh/send, and stores `dispatch_started_at` before transport handoff.
- A valid response receipt is persisted before replay. Replay reads the terminal row and cannot reach provider preparation or transport.
- A previous successful S038 proof returns `already_complete` and sends nothing.
- A prior in-progress, permanent, or uncertain outcome is not retried.
- Command output is fingerprinted; it never prints credentials, provider bodies, the full message, or the recipient after the private confirmation prompt.
