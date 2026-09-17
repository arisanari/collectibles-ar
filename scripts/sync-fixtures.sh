#!/usr/bin/env bash
# Syncs the single source of truth fixtures (fixtures/demo/) to each client's
# local fixture location. Run this after editing fixtures/demo/*.json.
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/fixtures/demo"

DEST_DIRS=(
  "$ROOT_DIR/apps/web/lib/fixtures/demo"
  "$ROOT_DIR/packages/TwinfoldCore/Sources/TwinfoldCore/Resources/fixtures/demo"
)

for dest in "${DEST_DIRS[@]}"; do
  mkdir -p "$dest"
  cp "$SRC_DIR"/*.json "$dest/"
  echo "synced fixtures -> $dest"
done
