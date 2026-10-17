#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${THREADS_DATA_DIR:-./data}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
SOURCE="$DATA_DIR/app.db"
[ -f "$SOURCE" ] || { printf 'database not found: %s\n' "$SOURCE" >&2; exit 1; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/app-$STAMP.db"
node --input-type=module - "$SOURCE" "$TARGET" <<'NODE'
import { DatabaseSync } from 'node:sqlite';
const [sourcePath, targetPath] = process.argv.slice(2);
const source = new DatabaseSync(sourcePath, { readOnly: true });
const escaped = targetPath.replaceAll("'", "''");
source.exec(`VACUUM INTO '${escaped}'`);
source.close();
NODE
printf 'backup created: %s\n' "$TARGET"
