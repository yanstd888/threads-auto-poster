# Security Policy

## Supported versions

Security fixes target the latest release and the default branch. Self-hosted deployments should update promptly and keep the app behind HTTPS and an authenticated ingress.

## Reporting a vulnerability

Do not open a public issue for an exploitable vulnerability. Send a private report to the maintainer listed in the repository profile, including:

- affected version or commit;
- deployment context;
- reproducible steps or a minimal proof;
- impact and suggested remediation, if known.

Do not include real tokens, passwords, private keys, or production data in a report. Redact them before sending.

The maintainer will acknowledge receipt when practical, reproduce the report, coordinate a fix, and publish a release note when disclosure is safe.

## Self-hosting security baseline

- Set unique `JWT_SECRET`, `ADMIN_PASSWORD`, and `TOKEN_ENCRYPTION_KEY` values.
- Keep `.env`, SQLite data, backups, and OAuth credentials outside version control.
- Run behind HTTPS and restrict the internal listener to loopback or a private network.
- Keep posting mode on approval until source, content, and publish behavior are reviewed.
- Back up the SQLite database before upgrades and test restore procedures.
- Never paste raw tokens or passwords into issues, logs, or chat.
