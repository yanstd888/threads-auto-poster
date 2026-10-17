# Contributing

## Development

1. Copy `.env.example` to `.env.local` and fill local-only values.
2. Install the pinned dependencies with `npm ci`.
3. Run the focused checks:

```bash
npx tsc --noEmit --pretty false
npx tsx check-content-and-schedule.ts
npm run build
```

Use approval mode for local development unless a test explicitly needs another setting. Do not use real publishing credentials in tests.

## Pull requests

- Keep changes small and explain the user-visible behavior.
- Add or update a regression check for non-trivial logic.
- Do not commit `.env`, SQLite databases, backups, tokens, password hashes, or private keys.
- Preserve Apache-2.0 notices and mark modified files when required.
- Do not change posting limits, source-fetch rules, auth, or publish behavior without documenting the safety impact.

## Content and source changes

Sources must be HTTPS public URLs. Generated content must remain grounded in approved sources, pass the quality gate, and avoid engagement bait or unsupported claims. New UI labels belong in both `id` and `en` dictionaries.

## Commit hygiene

Never force-push or rewrite another contributor's work. Keep credentials and production deployment changes out of pull requests unless explicitly required and reviewed.
