#!/usr/bin/env bash
set -euo pipefail

BACKUP="${1:-}"
DATA_DIR="${THREADS_DATA_DIR:-./data}"
if [ -z "$BACKUP" ] || [ "${RESTORE_CONFIRM:-}" != "YES" ]; then
  printf 'usage: RESTORE_CONFIRM=YES %s <backup.db>\n' "$0" >&2
  exit 2
fi
[ -f "$BACKUP" ] || { printf 'backup not found: %s\n' "$BACKUP" >&2; exit 1; }
mkdir -p "$DATA_DIR"
node --input-type=module - "$BACKUP" <<'NODE'
import { DatabaseSync } from 'node:sqlite';
const [backupPath] = process.argv.slice(2);
const db = new DatabaseSync(backupPath, { readOnly: true });
const result = db.prepare('PRAGMA integrity_check').get();
if (result?.integrity_check !== 'ok') throw new Error('backup integrity check failed');
db.close();
NODE
cp "$BACKUP" "$DATA_DIR/app.db"
rm -f "$DATA_DIR/app.db-shm" "$DATA_DIR/app.db-wal"
printf 'database restored: %s\n' "$DATA_DIR/app.db"
