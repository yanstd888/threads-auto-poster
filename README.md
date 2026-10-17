# Threads Auto Poster

Self-hosted Threads content scheduling and approval workflow with SQLite storage, source registry, grounded content generation, quality gates, and optional Threads publishing.

The project is designed to run locally or behind a private HTTPS ingress. Posting is **approval-first** by default.

## Features

- Configurable posts/day, active hours, timezone, active days, and minimum scheduler gap.
- Database-backed content pillars and compositions; ordinary edits do not require code changes.
- Indonesian and English UI/content language settings.
- HTTPS source registry with search, pagination, health checks, filters, import, and export.
- Config export/import for non-secret settings, sources, pillars, and compositions.
- Config transfer excludes tokens, password hashes, users, kill switch state, history, and runtime database rows.
- Single-admin password authentication with an HTTP-only session cookie and login rate limiting.
- SQLite WAL mode with backup and restore scripts.
- Docker Compose deployment with a persistent `/data` volume.
- Apache-2.0 licensed.

## Requirements

- Node.js 22+
- npm
- Docker Engine / Docker Desktop for the container workflow
- A Hermes CLI/provider only when generation is enabled
- Threads app credentials only when real publishing is enabled

## Local setup

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open `http://localhost:3000` unless your local command uses another port. Set a strong `ADMIN_PASSWORD` with at least 16 characters and a random `JWT_SECRET` before signing in.

The default data file is `data/app.db`. Set `THREADS_DATA_DIR` to move it elsewhere.

## Docker

```bash
cp .env.example .env
# edit .env; never commit it
docker compose -f compose.yaml up -d --build
```

The app binds to `127.0.0.1:${APP_PORT:-4000}`. Put Caddy, Nginx, Cloudflare Tunnel, or another controlled HTTPS ingress in front of it when remote access is needed.

Stop only this Compose project:

```bash
docker compose -f compose.yaml down
```

## Backup and restore

Back up while the app is running; the script uses SQLite `VACUUM INTO` for a consistent copy:

```bash
THREADS_DATA_DIR=./data BACKUP_DIR=./backups bash scripts/backup.sh
```

Restore only after stopping the app and checking the backup path:

```bash
docker compose -f compose.yaml stop app
THREADS_DATA_DIR=./data RESTORE_CONFIRM=YES bash scripts/restore.sh ./backups/app-YYYYMMDDTHHMMSSZ.db
```

The restore script refuses to run without `RESTORE_CONFIRM=YES`, checks SQLite integrity, and removes stale WAL sidecars.

## Configuration

Settings are changed in the dashboard. Relevant environment variables:

- `JWT_SECRET` — session signing secret.
- `ADMIN_PASSWORD` — initial single-admin password; existing SQLite credentials are preserved during startup.
- `TOKEN_ENCRYPTION_KEY` — encryption key for stored Threads tokens.
- `THREADS_DATA_DIR` — persistent SQLite directory.
- `MAX_POSTS_PER_DAY` — optional upper safety bound; default 288, with active-hour capacity still enforced.
- `NEXTAUTH_URL` / `APP_PUBLIC_URL` — allowed origins for same-origin mutation checks.
- `HERMES_PROVIDER`, `HERMES_MODEL`, `HERMES_BIN` — generation CLI settings.
- `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_OAUTH_REDIRECT_URI` — optional Threads OAuth settings.

Exported JSON is portable configuration, not a backup. Use the database backup scripts for runtime state.

## Safety defaults

- Approval mode is the default posting mode.
- Standalone posts are the default composition mode.
- Source URLs must use HTTPS and cannot target localhost, private, or link-local addresses.
- Generated content must cite approved sources and pass quality checks before it can be scheduled or published.
- Real provider credentials and production posting are not required for local checks.

## Verification

```bash
npx tsc --noEmit --pretty false
npx tsx check-content-and-schedule.ts
npm run build
```

CI also runs dependency installation, production build, audit checks, and repository secret guards.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).