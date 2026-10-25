#!/bin/sh
set -eu
FISHING_EXPLORER_APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js was not found. Use an approved Node.js 22 or later runtime.' >&2
  exit 1
fi
exec node "$FISHING_EXPLORER_APP_DIR/scripts/launch.mjs" "$@"
