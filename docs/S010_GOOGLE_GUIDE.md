# S010 — Google Cloud prerequisite guide

This is the human checkpoint for preparing Google OAuth without granting Rewind a live token or performing a Calendar/Gmail effect. Complete it with the team-controlled Google account protected by MFA. Never paste a client secret, client JSON, refresh token, calendar ID, recipient address, or Google identity identifier into chat, Git, screenshots, or tracked evidence.

## Canonical values

The callback path is frozen as `/api/v1/oauth/google/callback`. Register these exact URLs, with no query string, trailing slash, or extra redirect:

```text
http://localhost:3000/api/v1/oauth/google/callback
https://rewind-eta-jet.vercel.app/api/v1/oauth/google/callback
```

The deployed origin is the stable Production domain recorded by S009. Do not register a deployment-specific `*.projects.vercel.app` URL.

## 1. Create or select the Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) using the team-controlled account.
2. Create a dedicated project for Rewind, or select the already-approved team project.
3. Keep the project ID in a password manager or private team note. Record only a redacted project identifier in evidence.

## 2. Enable only the required APIs

Open **APIs & Services → Library** and enable:

- **Google Calendar API**
- **Gmail API**

Do not enable additional provider APIs for this task.

## 3. Configure the OAuth consent screen

Open **Google Auth platform → Branding** (Google may label this **OAuth consent screen**):

1. Choose **External** for the audience.
2. Keep publishing status **Testing**.
3. Enter the team-controlled demo app name, support email, and developer contact email.
4. Add exactly one dedicated demo Google identity under **Audience → Test users**.
5. Do not add unrelated accounts.

Testing mode is intentional. Google testing refresh grants expire after a short period, so the demo identity must be reauthorized within 24 hours of the final recording. S010 does not perform that grant.

## 4. Add the minimum Data Access scopes

In **Google Auth platform → Data Access**, add only these four scopes:

```text
openid
email
https://www.googleapis.com/auth/calendar.events.owned
https://www.googleapis.com/auth/gmail.send
```

Do not add `profile`, broad Calendar scopes, Gmail read/modify scopes, `gmail.compose`, or any mailbox-reading permission. Rewind never reads a mailbox.

## 5. Create the Web OAuth client

1. Open **Google Auth platform → Clients** (or **APIs & Services → Credentials**).
2. Choose **Create client → Web application**.
3. Add exactly these **Authorized redirect URIs**:

```text
http://localhost:3000/api/v1/oauth/google/callback
https://rewind-eta-jet.vercel.app/api/v1/oauth/google/callback
```

4. Do not add wildcard domains, query parameters, a trailing slash, preview URLs, or alternate callback paths.
5. Save the client.
6. Store the client ID and client secret in the password manager and later in the private deployment environment. Never commit the downloaded client JSON.

## 6. S010 stop condition

Do **not** click an OAuth grant, exchange a code, create a refresh token, create a Calendar event, or send Gmail. OAuth state/nonce/PKCE, token exchange, encrypted refresh-token storage, and live provider checks belong to later tasks (S031–S035).

Reply with this sanitized checklist only:

```text
S010 Google checkpoint
- Dedicated project: yes/no
- Calendar API enabled: yes/no
- Gmail API enabled: yes/no
- OAuth audience: External
- Publishing status: Testing
- Test users: exactly one configured
- Redirect URIs: exactly 2 (local + production)
- Scopes: openid, email, calendar.events.owned, gmail.send
- Web client created: yes/no
- Client secret stored privately: yes/no
- Live OAuth grant/effect performed: no
```

Never include the project ID, Google email, client ID, client secret, calendar ID, recipient addresses, subject identifiers, or raw Google Console screenshots.
