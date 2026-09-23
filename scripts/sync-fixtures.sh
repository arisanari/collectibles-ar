#!/usr/bin/env bash
# Syncs the single source of truth fixtures (fixtures/demo/) to each client's
# local fixture location. Run this after editing fixtures/demo/*.json or
# fixtures/demo/artworks/*.png.
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

# Reference artwork PNGs (fixtures/demo/artworks/*.png) have two separate
# consumers with different directory shapes:
# - Web serves them as static files from public/artworks/.
# - TwinfoldCore bundles them as a SwiftPM resource under
#   Resources/artworks/ (see Package.swift, Resources.swift).
# Optional: a repo without any PNGs yet (e.g. before art is added) should not
# fail the sync.
ARTWORK_DEST_DIRS=(
  "$ROOT_DIR/apps/web/public/artworks"
  "$ROOT_DIR/packages/TwinfoldCore/Sources/TwinfoldCore/Resources/artworks"
)

if compgen -G "$SRC_DIR/artworks/*.png" > /dev/null; then
  for dest in "${ARTWORK_DEST_DIRS[@]}"; do
    mkdir -p "$dest"
    cp "$SRC_DIR"/artworks/*.png "$dest/"
    echo "synced artworks -> $dest"
  done
else
  echo "no artwork PNGs found in $SRC_DIR/artworks, skipping"
fi
