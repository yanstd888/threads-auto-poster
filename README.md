<p align="center">
  <h1 align="center">Threads Auto Poster</h1>
  <p align="center">A self-hosted workspace for researching, drafting, reviewing, scheduling, and publishing Threads posts.</p>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="#deployment">Deployment</a> ·
  <a href="#safety">Safety</a>
</p>

<p align="center">
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg">
  <img alt="Runtime: Node.js 22+" src="https://img.shields.io/badge/node.js-22%2B-339933.svg">
  <img alt="Storage: SQLite" src="https://img.shields.io/badge/storage-SQLite-003B57.svg">
</p>

---

## Why this exists

Publishing consistently is easier when research, drafting, review, scheduling, and publishing live in one private workspace. Threads Auto Poster keeps that workflow self-hosted with SQLite, a source registry, an approval queue, and optional Threads publishing.

It starts in approval mode. Real publishing stays off until you connect a Threads account and explicitly review a draft.

## What it includes

| Area | Included |
| --- | --- |
| Content | Source-backed drafts, content pillars, compositions, and quality gates |
| Review | Draft queue, approval-first publishing, post history, and publish status |
| Schedule | Posts per day, active hours, timezone, active days, and minimum gaps |
| Sources | HTTPS-only registry with search, filters, health checks, import, and export |
| AI generation | Optional Hermes CLI integration with configurable provider and model |
| Threads | OAuth connection, encrypted token storage, and optional publishing |
| Operations | SQLite WAL, backup/restore scripts, config transfer, and Docker Compose |
| Access | One admin account, HTTP-only session cookie, and login rate limiting |

## How it works

```text
Approved HTTPS sources
        │
        ▼
Content pillars + compositions
        │
        ▼
Hermes CLI (optional)
        │
        ▼
Draft + quality checks
        │
        ▼
Approval queue ──► Schedule ──► Threads API
```

The content agent is optional. You can use the dashboard, sources, scheduling, backups, and Threads connection without it.

The dashboard displays the current version and checks the public GitHub Releases feed for newer releases. Updates remain manual: open the release notice, back up SQLite, pull the tagged source, reinstall dependencies, rebuild, and restart the service. The app never overwrites its own running files from a browser request.

## Quick start

Use the native Node.js workflow when you want content generation through Hermes.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open the URL printed by Next.js. Before signing in, set a strong `ADMIN_PASSWORD`, a random `JWT_SECRET`, and a separate `TOKEN_ENCRYPTION_KEY` in `.env.local`.

Then keep the safe defaults while you set up:

1. Sign in.
2. Leave posting mode on **Draft (approval required)**.
3. Keep the **Kill Switch** on.
4. Add approved sources in **Sumber**.
5. Configure pillars and compositions in **Pengaturan**.
6. Verify Hermes before enabling the Content Agent.
7. Connect Threads only after your public HTTPS callback is ready.

For the complete setup path, including Meta for Developers and OAuth, read [Getting Started](docs/GETTING_STARTED.md).

## Documentation

| Guide | Use it for |
| --- | --- |
| [Getting Started](docs/GETTING_STARTED.md) | First install, secrets, admin login, Hermes, Meta Threads, OAuth, publishing, and backups |
| [Setup](SETUP.md) | Environment variables and deployment details |
| [Open-source readiness](docs/OPEN_SOURCE_READINESS.md) | Public-release gates that still need proof |
| [Open-source plan](docs/OPEN_SOURCE_PLAN.md) | Scope and release plan |

## Hermes generation

Install and configure Hermes Agent as the same OS user that runs this app. Verify the exact provider and model before saving them in the dashboard:

```bash
printf 'Return exactly: HERMES_OK' | hermes chat --query-file - --oneshot --quiet --cli --provider YOUR_PROVIDER -m YOUR_MODEL
```

The command must print `HERMES_OK`. Set the exact provider and model names in **Pengaturan**, then enable the Content Agent.

`THREADS` can be used as a model only when your Hermes provider defines that model or alias.

## Threads connection

To publish to Threads, create a Threads app in Meta for Developers, register this exact callback pattern, and place the matching value in `THREADS_OAUTH_REDIRECT_URI`:

```text
https://your-domain.example/api/auth/threads/callback
```

Use **Kredensial → Connect Threads** to complete OAuth. The app encrypts the returned token in SQLite. See [Getting Started](docs/GETTING_STARTED.md#5-create-a-threads-app-in-meta-for-developers) for permissions, setup order, and operational checks.

## Deployment

### Native Node.js

This is the complete deployment path today because Hermes runs on the application OS:

```bash
npm ci
npm run build
npm run start
```

Keep the app behind HTTPS and an access layer when exposing it remotely.

### Docker Compose

```bash
cp .env.example .env
# edit .env; never commit it
docker compose -f compose.yaml up -d --build
```

The stock Docker image runs the dashboard, SQLite, scheduler, token storage, and Threads publishing. It does not include Hermes Agent, so do not enable content generation unless you provide a Hermes CLI inside that container.

The Compose app binds to `127.0.0.1:${APP_PORT:-4000}`. Use a controlled HTTPS ingress such as Cloudflare Tunnel, Caddy, or Nginx for remote access.

Stop only this project:

```bash
docker compose -f compose.yaml down
```

## Backup and restore

Create a consistent SQLite backup while the app is running:

```bash
THREADS_DATA_DIR=./data BACKUP_DIR=./backups bash scripts/backup.sh
```

Restore only after stopping the app and checking the selected backup:

```bash
docker compose -f compose.yaml stop app
THREADS_DATA_DIR=./data RESTORE_CONFIRM=YES bash scripts/restore.sh ./backups/app-YYYYMMDDTHHMMSSZ.db
```

The restore script requires `RESTORE_CONFIRM=YES`, checks SQLite integrity, and removes stale WAL sidecars.

## Safety

- Approval mode is the default posting mode.
- Standalone posts are the default composition mode.
- Source URLs must use HTTPS and cannot point to localhost, private, or link-local addresses.
- Generated content must cite approved sources and pass quality checks before scheduling or publishing.
- A `publish_unknown` result is not auto-retried because Threads may already have accepted the post.
- Config export excludes tokens, password hashes, users, kill switch state, history, and runtime database rows.

## Verification

```bash
npx tsc --noEmit --pretty false
npx tsx check-content-and-schedule.ts
npm run build
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).