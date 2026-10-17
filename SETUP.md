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

## AI provider

Configure an OpenAI-compatible endpoint with `HERMES_BASE_URL`, `HERMES_API_KEY`, and `HERMES_MODEL`, or point `HERMES_BIN` at a local compatible command. There is no bundled provider account or default private endpoint.

## Backup and restore

```bash
THREADS_DATA_DIR=./data BACKUP_DIR=./backups bash scripts/backup.sh
RESTORE_CONFIRM=YES THREADS_DATA_DIR=./data bash scripts/restore.sh ./backups/app-YYYYMMDDTHHMMSSZ.db
```

Stop the app before restore, keep a copy of the current database, and verify the reported SQLite integrity check before starting again.

See `README.md`, `SECURITY.md`, and `CONTRIBUTING.md` for the full deployment and contribution rules.
