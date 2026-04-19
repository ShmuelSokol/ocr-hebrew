#!/usr/bin/env bash
# Wrapper for scripts/db-backup.js — sources .env.local and invokes node.
# Designed for cron on the Mac Mini. Do NOT invoke directly; use npm run db:backup for interactive use.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
source .env.local
set +a

/opt/homebrew/bin/node scripts/db-backup.js
