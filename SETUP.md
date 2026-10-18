# Threads Auto-Poster — Setup Guide

## Local development

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open the URL printed by Next.js. The dashboard uses one admin password; there is no username field. Set `ADMIN_PASSWORD` in `.env.local` before exposing the app.

## Docker

```bash
cp .env.example .env
docker compose -f compose.yaml up -d --build
```

The app listens on `127.0.0.1:${APP_PORT:-4000}` and stores SQLite data in the named `threads-auto-poster-data` volume.

## Threads OAuth

1. Create your own Threads app in Meta for Developers.
2. Set `THREADS_APP_ID`, `THREADS_APP_SECRET`, and `THREADS_OAUTH_REDIRECT_URI` in `.env.local`.
3. Register the exact callback URL: `https://your-public-host.example/api/auth/threads/callback`.
4. Open **Credentials** in the dashboard and connect the account.

Keep the app behind HTTPS or a trusted private network. Do not commit `.env.local`, tokens, database files, or provider credentials.

## Hermes Agent

Content generation invokes the `hermes` CLI from the same OS user that runs this application. Install Hermes Agent, configure your own provider, then run a one-line probe before enabling the Content Agent:

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes model
printf 'Return exactly: HERMES_OK' | hermes chat --query-file - --oneshot --quiet --cli --provider YOUR_PROVIDER -m YOUR_MODEL
```

Set the exact provider/model in **Pengaturan** after the probe succeeds. `THREADS` is a valid model default only when your provider has that model or alias. The stock Docker image does not include Hermes Agent; use the native Node.js deployment for content generation or build a custom image with Hermes installed.

See [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) for the complete Meta Threads and Hermes setup.

## Backup and restore

```bash
THREADS_DATA_DIR=./data BACKUP_DIR=./backups bash scripts/backup.sh
RESTORE_CONFIRM=YES THREADS_DATA_DIR=./data bash scripts/restore.sh ./backups/app-YYYYMMDDTHHMMSSZ.db
```

Stop the app before restore, keep a copy of the current database, and verify the reported SQLite integrity check before starting again.

See `README.md`, `SECURITY.md`, and `CONTRIBUTING.md` for the full deployment and contribution rules.
