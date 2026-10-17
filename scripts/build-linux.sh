#!/usr/bin/env bash
#
# Reproducible, UNSIGNED Linux build of SpaceVibe Deck.
#
# Clones the source at a pinned ref, applies packaging/linux/linux-support.patch,
# builds the renderer and the Electron main process, and packages an AppImage and
# a .deb. It changes nothing that ships: the macOS and Windows release workflows
# are untouched, and nothing produced here is published.
#
# Usage:
#   scripts/build-linux.sh [ref]        # ref defaults to v2.10.0
#
# Environment:
#   SPACEVIBE_UPSTREAM   git URL to clone (default: the canonical repository)
#   SPACEVIBE_BUILD_DIR  working directory (default: a fresh temp dir)
#   SPACEVIBE_OUT        output directory (default: <repo>/dist-electron-linux)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="${1:-v2.10.0}"
UPSTREAM="${SPACEVIBE_UPSTREAM:-https://github.com/mxrsv/spacevibe-deck.git}"
OUT="${SPACEVIBE_OUT:-$HERE/dist-electron-linux}"
WORK="${SPACEVIBE_BUILD_DIR:-}"

log() { printf '\n==> %s\n' "$*"; }

if [ -z "$WORK" ]; then
  WORK="$(mktemp -d)"
  CLEANUP=1
else
  CLEANUP=0
fi
trap '[ "$CLEANUP" = 1 ] && rm -rf "$WORK"' EXIT

log "Upstream: $UPSTREAM"
log "Ref:      $REF"
log "Work dir: $WORK"

log "Cloning the source at $REF"
git clone --depth 1 --branch "$REF" "$UPSTREAM" "$WORK/src"

cd "$WORK/src"

log "Applying packaging/linux/linux-support.patch"
patch -p1 < "$HERE/packaging/linux/linux-support.patch"

log "Adding the Linux electron-builder config"
cp "$HERE/packaging/linux/electron-builder.linux.yml" .

log "Installing dependencies"
npm ci

# The renderer's `prebuild` hook regenerates src-tauri/src/menu_registry.rs with
# rustfmt, which the Electron build neither needs nor ships. Call the two real
# steps directly so a machine without a Rust toolchain can still build.
log "Building renderer and Electron main"
npx tsc
npx vite build
npm run electron:build

log "Packaging AppImage + deb"
npx electron-builder --config electron-builder.linux.yml --linux --x64 --publish never

mkdir -p "$OUT"
cp dist-electron-linux/*.AppImage "$OUT/"
cp dist-electron-linux/*.deb "$OUT/"

log "Done. Artifacts in $OUT:"
ls -1 "$OUT"
