# Open-Source Release Status

Status on 2026-10-18: **not ready to publish yet**.

## Completed

- [x] Apache-2.0 license, NOTICE, contributing/security/conduct files, and issue templates.
- [x] Secret-free `.env.example` and ignored runtime database/environment files.
- [x] TypeScript check, content/scheduler regression checker, production build, Docker build, and dependency audit have passed on the clean release copy.
- [x] SQLite persistence, backup/restore scripts, and approval-first publishing controls.
- [x] End-to-end getting-started documentation for native deployment, Hermes Agent, Meta Threads OAuth, dashboard operation, backup, and failure recovery.
- [x] Explicit warning that the stock Docker image does not include Hermes Agent.

## Required before a public GitHub release

- [ ] Add and verify a supported Docker image path that includes Hermes Agent, or label Docker as dashboard/publishing-only and remove it from the full-workflow quick start.
- [ ] Run one fresh-machine native install using only the published README, `.env.example`, and `docs/GETTING_STARTED.md`.
- [ ] Run one clean Docker install and verify its documented feature boundary.
- [ ] Perform an owner-controlled Meta OAuth connection against a new test app/account and verify the exact current Meta permission/review requirements.
- [ ] Perform an owner-controlled Threads test publish from approval mode, then record the result without committing tokens, content, or account identifiers.
- [ ] Re-run secret scanning and the release acceptance matrix after the final documentation and Docker decision.
- [ ] Commit/tag/push only after the user approves the final public repository state.

## Why the status is not promoted

A healthy production deployment does not prove that a stranger can clone, configure, connect Meta, and generate content without private infrastructure. In particular, the stock Docker runtime lacks the `hermes` binary that the generator starts. That must be resolved or made an explicit supported limitation before release.
