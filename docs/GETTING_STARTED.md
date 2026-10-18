# Getting Started

This guide takes a new administrator from an empty server to a working, approval-first Threads workflow.

## 1. Choose a supported runtime

Content generation runs the `hermes` CLI as the same OS user that runs this app. Use the **native Node.js deployment** for the complete workflow today:

```bash
cp .env.example .env.local
npm ci
npm run build
npm run start
```

Docker Compose is supported for the dashboard, SQLite persistence, token storage, scheduling, and publishing. The stock image does **not** include Hermes Agent, so it cannot generate content until you provide a Hermes CLI in that container. Do not enable the Content Agent in that mode yet.

For either mode, use HTTPS before connecting Threads. Keep the application origin private or behind an access layer.

## 2. Create the local secrets

Copy the template and generate separate values:

```bash
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set these in `.env.local`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Signs the admin session cookie. |
| `ADMIN_PASSWORD` | Yes | First admin password; at least 16 characters. |
| `TOKEN_ENCRYPTION_KEY` | Yes before Threads connection | Encrypts the stored Threads token. Keep it unchanged after connecting an account. |
| `THREADS_DATA_DIR` | Recommended | Directory holding `app.db`; back it up. |
| `NEXTAUTH_URL` and `APP_PUBLIC_URL` | Yes for public access | Exact public HTTPS origin used by same-origin checks. |

Never commit `.env.local`, `data/`, `*.db`, backup files, Hermes credential files, or Threads credentials.

## 3. Start and sign in

```bash
npm run dev
```

Open the URL printed by Next.js, then sign in with `ADMIN_PASSWORD`. The application creates the first password hash only when no existing admin credential is present.

Before enabling automation:

1. Leave **Posting mode** as **Draft (approval required)**.
2. Keep the **Kill Switch** on while completing setup.
3. Add approved sources in **Sumber**.
4. Review or adjust pillars and compositions in **Pengaturan**.

## 4. Configure Hermes Agent

Install and configure Hermes Agent under the **same OS account** that starts this application. Hermes must have at least one working LLM provider.

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes model
```

Choose your own provider/model or configure a named OpenAI-compatible provider in Hermes. Store provider credentials in Hermes' own `~/.hermes/.env`; do not put them into this application's database or repository.

Verify Hermes before changing app settings:

```bash
printf 'Return exactly: HERMES_OK' | hermes chat --query-file - --oneshot --quiet --cli --provider YOUR_PROVIDER -m YOUR_MODEL
```

The command must print `HERMES_OK`.

Then in **Pengaturan** set:

| Dashboard setting | Value |
| --- | --- |
| Hermes provider | Exact Hermes provider name, for example `my-provider`. |
| Hermes model | Exact model ID or alias configured for that provider. |
| Hermes profile | `default`; current Hermes CLI invocation does not use a named profile. |

`THREADS` is a valid default only when your chosen provider defines or accepts a model/alias named `THREADS`. It is not a universal Hermes model name.

If the dashboard shows `Hermes is not connected to any AI provider yet`, the app process is invoking Hermes without a usable provider. Re-run the command above as the app's OS user and correct the provider/model dashboard values.

## 5. Create a Threads app in Meta for Developers

Each deployment needs its own Threads app and its own credentials.

1. Sign in at Meta for Developers and create an app with the **Threads** use case.
2. Add the app's public HTTPS callback URL exactly as shown below. The scheme, host, path, and trailing slash must match exactly:

   ```text
   https://your-domain.example/api/auth/threads/callback
   ```

3. Set the same URL in `THREADS_OAUTH_REDIRECT_URI`.
4. Copy the **Threads App ID** and **Threads App Secret** into `THREADS_APP_ID` and `THREADS_APP_SECRET`.
5. Request only the permissions needed by this app:
   - `threads_basic` for account access;
   - `threads_content_publish` for publishing;
   - `threads_manage_insights` only if Analytics is used.
6. Confirm any Meta app-review, test-user, business-verification, and platform-policy requirements that apply to your app before enabling production users.
7. Restart the application after changing environment variables.

The Threads App ID/Secret are the Threads credentials shown in the Threads app settings. Do not substitute unrelated Meta app credentials.

Official references:

- Meta Threads developer documentation: <https://developers.facebook.com/docs/threads/>
- Meta Threads API changelog: <https://developers.facebook.com/docs/threads/changelog>
- Meta's official Threads Postman workspace: <https://www.postman.com/meta/threads/overview>
- Meta's official sample app: <https://github.com/fbsamples/threads_api>

## 6. Connect the Threads account

1. Go to **Kredensial**.
2. Select **Connect Threads**.
3. Complete Meta authorization in the browser.
4. Return to the dashboard and verify the connected username and expiration status.

The application stores the received access token encrypted in SQLite. It exchanges the authorization code, then requests a long-lived token. Do not paste tokens into screenshots, issue reports, or GitHub discussions.

## 7. Generate, review, and publish

1. Turn **Content Agent** on only after Hermes verification passes.
2. Add at least one approved HTTPS source and one active pillar.
3. Generate a draft from **Konten** or wait for a scheduled slot.
4. Read the source link, content, quality status, and CTA.
5. In approval mode, publish only the reviewed draft.
6. Use auto-post only after the account, provider, schedule, and quality output are proven stable.

The app publishes a root Threads post first, then verifies it by reading it back. A `publish_unknown` status is deliberately not auto-retried because the platform may already have accepted the post.

## 8. Backup before upgrades

```bash
THREADS_DATA_DIR=./data BACKUP_DIR=./backups bash scripts/backup.sh
```

Verify a backup before restoring it:

```bash
sqlite3 -readonly ./backups/app-YYYYMMDDTHHMMSSZ.db 'PRAGMA integrity_check;'
```

For restore instructions, see [README.md](../README.md#backup-and-restore). Never restore over a live database without first making a fresh backup.

## 9. Operational checklist

- [ ] `npm run build` passes.
- [ ] Hermes probe prints the expected response under the app OS user.
- [ ] The public HTTPS callback is registered in Meta and matches `THREADS_OAUTH_REDIRECT_URI` exactly.
- [ ] Threads connection appears in **Kredensial**.
- [ ] Sources are approved and content stays in approval mode.
- [ ] A SQLite backup has passed `PRAGMA integrity_check`.
- [ ] Secrets and runtime database files are excluded from Git.
