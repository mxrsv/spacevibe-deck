#!/bin/sh

set -eu

RELEASE_API="https://api.github.com/repos/mxrsv/spacevibe-deck/releases/latest"
RELEASES_PAGE="https://github.com/mxrsv/spacevibe-deck/releases"
APP_NAME="SpaceVibe Deck.app"

fail() {
  printf 'SpaceVibe Deck install failed: %s\n' "$1" >&2
  printf 'Download manually: %s\n' "$RELEASES_PAGE" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "macOS is required."
[ "$(uname -m)" = "arm64" ] || fail "Apple Silicon (arm64) is required."

command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v osascript >/dev/null 2>&1 || fail "osascript is required."
command -v hdiutil >/dev/null 2>&1 || fail "hdiutil is required."
command -v codesign >/dev/null 2>&1 || fail "codesign is required."
command -v spctl >/dev/null 2>&1 || fail "spctl is required."
command -v ditto >/dev/null 2>&1 || fail "ditto is required."

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/spacevibe-deck.XXXXXX") || fail "Could not create a temporary directory."
mount_dir="$work_dir/mount"
release_json="$work_dir/release.json"
dmg_path="$work_dir/SpaceVibe-Deck.dmg"
mounted=0

cleanup() {
  if [ "$mounted" -eq 1 ]; then
    hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
  fi

  rm -rf "$work_dir"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$mount_dir"

curl \
  --fail \
  --silent \
  --show-error \
  --location \
  --proto '=https' \
  --proto-redir '=https' \
  --tlsv1.2 \
  --retry 2 \
  --header 'Accept: application/vnd.github+json' \
  --output "$release_json" \
  "$RELEASE_API" || fail "Could not resolve the latest stable release."

release_data=$(
  osascript -l JavaScript - "$release_json" <<'JXA'
ObjC.import("Foundation");

function abort(message) {
  throw new Error(message);
}

function run(argv) {
  const path = argv[0];
  const source = ObjC.unwrap(
    $.NSString.stringWithContentsOfFileEncodingError(
      path,
      $.NSUTF8StringEncoding,
      null,
    ),
  );

  if (typeof source !== "string") {
    abort("Release response could not be read.");
  }

  const release = JSON.parse(source);

  if (
    !release ||
    typeof release !== "object" ||
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.tag_name !== "string" ||
    !/^v?\d+\.\d+\.\d+$/.test(release.tag_name) ||
    !Array.isArray(release.assets)
  ) {
    abort("Release response is not a published stable release.");
  }

  const matches = release.assets.filter((asset) => {
    if (
      !asset ||
      typeof asset.name !== "string" ||
      typeof asset.browser_download_url !== "string" ||
      !/^[A-Za-z0-9._-]+-arm64\.dmg$/.test(asset.name)
    ) {
      return false;
    }

    const expected =
      "https://github.com/mxrsv/spacevibe-deck/releases/download/" +
      encodeURIComponent(release.tag_name) +
      "/" +
      encodeURIComponent(asset.name);

    return asset.browser_download_url === expected;
  });

  if (matches.length !== 1) {
    abort("Release must contain exactly one trusted Apple Silicon DMG.");
  }

  return release.tag_name + "\n" + matches[0].browser_download_url;
}
JXA
) || fail "Release metadata validation failed."

release_version=$(printf '%s\n' "$release_data" | sed -n '1p')
dmg_url=$(printf '%s\n' "$release_data" | sed -n '2p')

[ -n "$release_version" ] || fail "Release version is missing."
[ -n "$dmg_url" ] || fail "Release asset URL is missing."

printf 'Installing SpaceVibe Deck %s for Apple Silicon...\n' "$release_version"

curl \
  --fail \
  --silent \
  --show-error \
  --location \
  --proto '=https' \
  --proto-redir '=https' \
  --tlsv1.2 \
  --retry 2 \
  --output "$dmg_path" \
  "$dmg_url" || fail "Could not download the signed DMG."

hdiutil attach \
  -nobrowse \
  -readonly \
  -mountpoint "$mount_dir" \
  "$dmg_path" >/dev/null || fail "Could not mount the DMG."
mounted=1

app_paths=$(find "$mount_dir" -type d -name "$APP_NAME" -prune -print)
app_count=$(printf '%s\n' "$app_paths" | awk 'NF { count += 1 } END { print count + 0 }')

[ "$app_count" -eq 1 ] || fail "The DMG must contain exactly one $APP_NAME."
app_path=$(printf '%s\n' "$app_paths" | sed -n '1p')

codesign --verify --deep --strict "$app_path" || fail "Code signature verification failed."
spctl --assess --type execute "$app_path" || fail "Gatekeeper rejected the application."

if [ -d /Applications ] && [ -w /Applications ]; then
  install_root="/Applications"
else
  install_root="$HOME/Applications"
  mkdir -p "$install_root" || fail "Could not create $install_root."
fi

install_path="$install_root/$APP_NAME"
ditto "$app_path" "$install_path" || fail "Could not copy the application to $install_root."

printf 'Installed SpaceVibe Deck %s at %s\n' "$release_version" "$install_path"
