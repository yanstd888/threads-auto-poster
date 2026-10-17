# Open-Source Readiness Plan

## Objective
Turn Threads Auto-Poster into a self-hostable, single-admin open-source project. A new user can configure it without Yanstd infrastructure, connect their own Threads account, define their own content system, and run it safely with persistent data.

Existing `tasks/plan.md` and `tasks/todo.md` are intentionally untouched: they still contain the earlier content-learning plan's remaining final verification.

## Capability Map

| Module | Responsibility | Depends on |
|---|---|---|
| platform-config | Remove hard product limits; schedule, throughput, and safe configuration | — |
| content-system | Dynamic pillars, compositions, promo rules, language-aware generation | platform-config |
| source-registry | Paginated registry, filters, import/export, health | content-system |
| identity-ui | PIN/password admin login, bilingual UI, external links | platform-config |
| distribution | Docker/self-host guide, secure defaults, backups, env examples | platform-config |
| project-governance | README, license, contributing, security policy, release workflow | distribution |

Build order: platform-config → content-system → source-registry → identity-ui → distribution → project-governance.

## Decisions Proposed

1. **No artificial 10-post daily cap.** Replace the current `1..10` UI/API/scheduler validation with a configurable positive integer. Keep separate per-hour throttling and platform-limit configuration; do not promise an account can publish any arbitrary volume.
2. **Release preparation happens last.** Complete and verify all product changes in this working tree first. Only then clone/copy the verified source into a clean release folder, remove unused/personal/runtime files there, add `.env.example`, and scan it before GitHub upload; do not publish the live working directory.
3. **Dynamic content system.** Replace hard-coded `PILLAR_CYCLE`, `STRATEGIES`, fixed promo ratio, and fixed language with database-backed definitions. Built-in starter presets are seed data, not source code policy.
4. **Standalone-first posts.** Default output remains one root post (source URL, CTA, hashtags included) because reply-chain permission is optional and account-specific. Reply chains become an explicit composition option, disabled by default.
5. **Single-admin authentication.** One password/PIN secret in environment, no username field or user-management UI. Store only a password hash in SQLite. Require a stronger minimum for internet-exposed deployments; PIN is acceptable only behind Cloudflare Access/LAN.
6. **Bilingual product.** UI locale and content locale are independent settings: `id` / `en`. Each pillar/composition can override the global content locale.
7. **Self-host first.** Docker Compose is the documented default. SQLite stays supported as a mounted volume with scheduled backups.
8. **License: Apache-2.0.** Add it only to the clean public-release copy after the product acceptance gates pass.

## Phase Plan

### Phase 0 — Open-source safety baseline

**Task 0.1 — Repository hygiene** *(implemented; clean release copy prepared)*
- Add `.gitignore`, `.env.example`, secret-free sample data, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and GitHub issue/PR templates.
- Remove Yanstd-specific defaults, URLs, account names, local paths, and production hostname assumptions from runtime defaults and docs.
- Added `.env.example`, Apache-2.0 `LICENSE`/`NOTICE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, and secret/runtime ignore rules. The clean release copy has no runtime database, environment secret file, personal path, production hostname, or tracked secret pattern.

**Task 0.2 — Reproducible self-host baseline** *(implemented and locally accepted)*
- Add Dockerfile, Compose file, persistent `/data` volume, healthcheck, backup command, and upgrade/migration procedure.
- Added standalone Docker image, Compose volume/healthcheck, and SQLite backup/restore scripts. Docker Compose startup, health, security headers, restart persistence, and backup/restore integrity checks pass locally.

### Phase 1 — Configuration and throughput

**Task 1.1 — Remove daily hard cap** *(implemented in working folder)*
- Replace all `1..10` validation and scheduler clamping with an explicit configurable maximum suitable for the deployment.
- Add validation for active-hour capacity and a clear error when requested posts cannot fit safely.
- Current guard: `MAX_POSTS_PER_DAY` defaults to `288` and can be lowered via environment; slots keep a minimum five-minute gap.
- Acceptance: 11, 25, and configured higher values schedule correctly; scheduler still enforces worker and publish-rate guards.

**Task 1.2 — Config schema and import/export** *(implemented and locally accepted)*
- Define versioned JSON export/import for non-secret settings, content definitions, and sources.
- Current schema version is `1`; secrets, tokens, users, kill switch, history, and runtime database rows are excluded.
- The `content_definitions` field carries pillar and composition definitions from Phase 2.
- Acceptance: export → clean DB → import recreates configuration without tokens/password hashes/history.

### Phase 2 — Dynamic content system

**Task 2.1 — Pillars and promotion rules** *(implemented in working folder)*
- Added database-backed `content_pillars` records with name, slug, enabled, weight, locale, source policy, promo eligibility, and position.
- Added authenticated `/api/pillars` GET/POST/PATCH and Settings UI to add, disable, weight, and reorder pillars.
- Scheduler now uses enabled pillar weights/order; promotion is allowed only for pillars marked promo-eligible.
- Custom pillar source policy and generic strategy fallback are used during content preparation.
- Config export/import now carries pillar definitions; legacy empty definitions remain valid.
- Acceptance: custom pillar changes are persisted without TypeScript changes; minimum one active pillar is enforced.

**Task 2.2 — Content compositions** *(implemented in working folder)*
- Added seeded editable compositions: education, case study, checklist, opinion, soft promotion, and product update.
- Added authenticated `/api/compositions` GET/POST/PATCH and Settings UI for hook, structure, CTA, length, mode, hashtag policy, source-link policy, and prompt text.
- Scheduler selects an enabled composition deterministically and records `composition_slug` in `post_attributes`.
- Config export/import carries composition definitions without secrets or runtime history.
- Acceptance: a user-created composition is selected by the generation pipeline and recorded in post metadata.

**Task 2.3 — Content locale** *(implemented in working folder)*
- Add `id` / `en` UI and content locale settings plus composition/pillar overrides.
- Translate UI dictionaries and make prompt/quality rules locale-aware; do not run Indonesian regexes against English output.
- Added `id`/`en` UI/content settings, locale-aware prompt/quality rules, and pillar/composition overrides. TypeScript, regression checker, targeted lint, and API read/write checks pass; browser copy review remains optional before publishing.

### Phase 3 — Source registry

**Task 3.1 — Paginated source registry** *(implemented in working folder)*
- Add server-side pagination, search, pillar/status/source-type filters, page-size control, and stable ordering.
- Added server-side pagination, search, health/status filters, approved/source-type filters, stable ordering, and paginated UI.

**Task 3.2 — Source operations** *(implemented in working folder)*
- Added bulk approval updates, bounded bulk health checks, health history, CSV/JSON export, JSON import, duplicate/malformed reporting, and dry-run import before mutation. Existing URLs update idempotently.

### Phase 4 — Identity and navigation

**Task 4.1 — Password/PIN-only admin login** *(implemented in working folder)*
- Replace username login with one secret (`ADMIN_PASSWORD` or `ADMIN_PIN`); preserve rate limiting, same-origin checks, secure cookie, and audit events.
- Migrated legacy `users` to `admin_credentials`, removed username from admin login/API/JWT, retained rate limiting, same-origin checks, secure cookie flags, and audit events. Threads account usernames remain account metadata, not admin identity.

**Task 4.2 — External product links** *(implemented in working folder)*
- Add configurable GitHub and website URLs to settings/environment.
- Add compact GitHub and website links above Kill Switch; hide a link when unset.
- Added configurable GitHub/website links above Kill Switch and removed hard-coded production OAuth assumptions. Links remain hidden when unset.

### Phase 5 — Documentation and release

**Task 5.1 — Replace README and setup guide** *(implemented in working folder)*
- Document overview, screenshot/architecture, prerequisites, local/Docker install, environment table, Threads OAuth, callback URL, first login, sources, pillars/compositions, scheduler, backups, upgrades, troubleshooting, and security model.
- Replaced public README and setup guide with local/Docker install, environment, OAuth, source/content configuration, backup/restore, security, and verification instructions.

**Task 5.2 — CI and release checks** *(implemented in working folder; GitHub execution pending)*
- Add CI for TypeScript, regression checker, build, dependency audit, secret scan, and Docker build.
- Added CI typecheck/regression/build/audit/secret guards, a tagged release workflow that rebuilds the image, and semantic-versioning guidance in `CHANGELOG.md`.

## Checkpoints

1. **After Phase 1:** 11+ posts/day works without breaking schedule capacity or worker limits.
2. **After Phase 2:** create a custom English pillar + composition in UI and generate a grounded draft without editing TypeScript.
3. **After Phase 3:** import 1,000 sources, filter/paginate, and export cleanly.
4. **After Phase 4:** password-only login and links work under HTTPS.
5. **Before public release:** clean-clone Docker installation, OAuth connection, one controlled publish, backup/restore, and security review all pass.

## Additional Public-Release Requirements

- **License and trademark:** choose a license and clarify whether the name/logo may be reused. Recommendation: Apache-2.0 for broad adoption; AGPL-3.0 only if hosted forks must publish their modifications.
- **No bundled AI provider/account:** use an OpenAI-compatible endpoint setting and document local/hosted options. Never ship Yanstd/9router credentials or a hidden default endpoint.
- **Rate/cost controls:** per-day, per-hour, worker cap, prompt/token cap, provider timeout, and dry-run mode must all be user-configurable.
- **Approval mode and audit export:** keep approval as default, show exact provider/model/source/locale/composition used, and permit audit-log export.
- **Data portability:** export/import settings, sources, compositions, and schedule; keep tokens/password hashes/history excluded by default.
- **Backups and restore drill:** document SQLite backup, restore, retention, and integrity check; test it in CI or release acceptance.
- **Accessibility and responsive UI:** keyboard navigation, labels, visible focus, color-independent status, mobile schedule/source views.
- **Privacy notice:** explain local data stored, outbound calls (Threads API, content provider, source URLs), and what users must disclose for their own deployment.
- **Threat model:** login rate limits, secure cookies, reverse-proxy guidance, CSRF/same-origin, secret handling, source URL SSRF protection, dependency updates, and supported deployment boundary.
- **Support boundaries:** state clearly that each deployer supplies their own Threads app, provider account, OAuth callback, and complies with platform policies.

## Risks

| Risk | Mitigation |
|---|---|
| Custom prompts weaken grounding/quality | Composition schema has hard safety fields; quality gate remains server-side. |
| High volume consumes provider budget or hits platform limits | Explicit per-hour/cost/worker caps, dry-run, and quota warnings. |
| PIN exposed publicly is weak | Strong password default; PIN only allowed with explicit acknowledgement or trusted-access deployment. |
| Schema becomes a migration trap | Idempotent migrations, export/import version field, backup before migrations. |
| Generic open-source setup leaks Yanstd assumptions | Clean-clone acceptance test plus secret/personal-data scan before publishing. |
| OAuth permissions differ by account/app review state | Standalone root posts remain default; optional reply chain has a capability check and visible setup state. |

## Open Questions Requiring Your Decision

1. **Admin credential:** strong password only.
2. **Product branding:** generic `Threads Auto-Poster` with optional links configured by each deployer.
3. **Storage scope:** SQLite-only v1.
4. **AI provider interface:** OpenAI-compatible endpoint only.
5. **Public release policy:** approval mode default.

## Commands To Verify Each Implementation Slice

```bash
set -a; . ./.env.local; set +a
npx tsc --noEmit --pretty false
npx tsx check-content-and-schedule.ts
npm run build
```
