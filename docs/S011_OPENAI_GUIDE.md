# S011 — OpenAI project-access guide

This is the human checkpoint for verifying project-level access to the configured OpenAI model. It performs one read-only model metadata request and does not run Rewind planning, Responses calls, strict-schema inference, or any external effect. Never paste an API key, project ID, organization ID, key prefix, provider response, or usage/billing details into chat, Git, screenshots, or tracked evidence.

## Target model

The repository’s initial candidate is:

```text
gpt-5.6-sol
```

The model remains configuration, not a hard-coded product invariant. OpenAI’s current model guidance identifies `gpt-5.6-sol` as the flagship model; project-level access still must be verified with the team-controlled project. See [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model).

## 1. Create or select the OpenAI project

1. Open the [OpenAI Platform](https://platform.openai.com/).
2. Use the team-controlled account and MFA.
3. Create or select a dedicated project for Rewind.
4. Keep the project identifier in a password manager or private team note. Record only `configured` in evidence.

## 2. Create a project-scoped API key

1. Open the selected project’s **API keys** page.
2. Create a new project-scoped secret key for Rewind.
3. Give it only the permissions needed for the later Responses API integration; do not grant unrelated administrative access.
4. Copy it once into the password manager. The full key is shown only at creation time.
5. Do not paste it into chat, Git, screenshots, shell command arguments, or the browser URL.

## 3. Configure local verification privately

In the ignored local `.env.local` file, set:

```text
OPENAI_API_KEY=<your private project key>
OPENAI_MODEL=gpt-5.6-sol
```

Do not edit `.env.example` with a real value. Do not add the key to Vercel yet; S012 owns the complete private environment contract.

## 4. Run the sanitized access check

From the repository root, run:

```bash
npm run verify:openai-access
```

The command makes a read-only `GET /v1/models/{configured-model}` request. A successful result is only:

```json
{"status":"ok","model":"gpt-5.6-sol"}
```

A failure reports only `status: "failed"` and the configured model name. It never prints the key, request headers, provider response, or diagnostic body. Do not retry repeatedly if the project rejects the model; stop and report the sanitized failure.

If `gpt-5.6-sol` is unavailable, do not silently substitute another model. Record the failure and make an explicit model decision before changing `OPENAI_MODEL`.

## 5. S011 stop condition

Do not call the Responses API, send prompts containing product data, enable model calls in the deployed application, or run strict-schema evaluations here. Those belong to S040–S045 after the contracts and evaluation fixtures are frozen.

Reply with this sanitized checklist only:

```text
S011 OpenAI checkpoint
- Dedicated project: configured
- API key: created and stored privately
- Configured model: <model name only>
- Model access: verified/failed
- Product Responses call: not run
- Strict-schema smoke: deferred to S040–S045
```

Never include the API key, project/org identifiers, key prefix, provider response, prompt, output, usage, or billing details.
