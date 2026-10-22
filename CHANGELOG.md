# Changelog

All notable project changes are recorded here.

## 0.3.2 - 2026-10-23

### Fixed

- Align public profile capability probing with the active VPS release.
- Tighten reply drafts and quality gates for concise, topic-grounded, natural replies.

### Security

- Update Next.js and its ESLint config to 16.4.2 to address the published production dependency advisory.

## 0.2.0 - 2026-10-19

### Added

- Dashboard version label and authenticated GitHub release update notification.
- Manual upgrade instructions; the application does not self-replace running files.

## 0.1.0 - 2026-10-18

### Added

- Open-source self-hosting baseline with Apache-2.0 licensing.
- Configurable scheduler capacity, dynamic pillars/compositions, bilingual content, source registry import/export/health, password-only admin auth, Docker persistence, and SQLite backup/restore.
- CI and tagged release workflows with secret guards and production dependency audit.

### Security

- Added security headers, SSRF-safe public source URL validation, same-origin checks, login rate limiting, and secret/runtime exclusion rules.

## Release policy

Use semantic version tags (`vMAJOR.MINOR.PATCH`). Keep release notes focused on user-visible changes, migrations, security fixes, and verification results.
