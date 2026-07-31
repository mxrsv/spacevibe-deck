// Upgrades the macOS download CTAs from the releases *page* to the release
// asset itself, so one click saves the .dmg instead of detouring through
// GitHub. Resolved at load time from the public releases API because the
// asset filename carries the version (SpaceVibe.Deck_0.9.0_universal.dmg) —
// a hard-coded URL would rot on every release.
//
// Failure contract: on any miss (offline, rate-limited, no .dmg asset) the
// anchors keep their server-rendered releases-page href, which is the
// intended fallback rather than an error state.

const LATEST_RELEASE_API =
  "https://api.github.com/repos/mxrsv/spacevibe-deck/releases/latest";

async function resolveMacAssetUrl() {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok) {
    return null;
  }

  const release = await response.json();
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const dmg = assets.find((asset) => asset?.name?.endsWith(".dmg"));

  return dmg?.browser_download_url ?? null;
}

export async function upgradeMacDownloadLinks(root) {
  let assetUrl = null;

  try {
    assetUrl = await resolveMacAssetUrl();
  } catch {
    return;
  }

  if (!assetUrl) {
    return;
  }

  // The hero and finale CTAs carry `data-copy="downloadMac"` on an inner
  // span; the footer link carries it on the anchor itself. closest() covers
  // both shapes.
  for (const el of root.querySelectorAll('[data-copy="downloadMac"]')) {
    const anchor = el.closest("a");

    if (!anchor) {
      continue;
    }

    anchor.href = assetUrl;
    // A direct file URL downloads in place; keeping target="_blank" would
    // just flash an empty tab.
    anchor.removeAttribute("target");
  }
}
