/**
 * Where the landing page sends people to get the app.
 *
 * The download anchors are server-rendered with releases *pages* — URLs that
 * never rot — and upgraded in place at load time: one call to the releases
 * API finds the newest macOS .dmg on a stable release and the newest Windows
 * installer on any published release. The Windows engineering preview ships
 * as a prerelease, which `releases/latest` never returns, hence the list
 * endpoint.
 *
 * Decided 2026-08-01: the Windows link follows the API like macOS, replacing
 * the hand-bumped WINDOWS_TAG pin — publishing a release is the act that
 * points the landing at it, so an unpublished build can never be served.
 *
 * Failure contract: on any miss (offline, rate limit, no matching asset) the
 * anchors keep their server-rendered page hrefs — a releases page, never a
 * dead file URL.
 */

export const REPO_URL = "https://github.com/mxrsv/spacevibe-deck";
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
// The list page: the Windows preview is a prerelease, invisible on /latest.
export const WINDOWS_FALLBACK_URL = `${REPO_URL}/releases`;

const RELEASES_API =
  "https://api.github.com/repos/mxrsv/spacevibe-deck/releases?per_page=10";

function assetUrl(release, suffix) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const hit = assets.find((asset) => asset?.name?.endsWith(suffix));

  return hit?.browser_download_url ?? null;
}

async function resolveAssetUrls() {
  const response = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok) {
    return { mac: null, win: null };
  }

  const releases = await response.json();

  if (!Array.isArray(releases)) {
    return { mac: null, win: null };
  }

  // The list arrives newest-first. macOS only trusts stable releases; the
  // Windows preview is published as a prerelease, so any release qualifies.
  const mac =
    releases
      .filter((release) => !release?.prerelease)
      .map((release) => assetUrl(release, ".dmg"))
      .find(Boolean) ?? null;
  const win =
    releases.map((release) => assetUrl(release, ".exe")).find(Boolean) ?? null;

  return { mac, win };
}

// The hero and finale CTAs carry `data-copy` on an inner span; the footer
// link carries it on the anchor itself. closest() covers both shapes.
function retargetAnchors(root, copyKey, url) {
  if (!url) {
    return;
  }

  for (const el of root.querySelectorAll(`[data-copy="${copyKey}"]`)) {
    const anchor = el.closest("a");

    if (!anchor) {
      continue;
    }

    anchor.href = url;
    // A direct file URL downloads in place; keeping target="_blank" would
    // just flash an empty tab.
    anchor.removeAttribute("target");
  }
}

export async function upgradeDownloadLinks(root) {
  let urls;

  try {
    urls = await resolveAssetUrls();
  } catch {
    return;
  }

  retargetAnchors(root, "downloadMac", urls.mac);
  retargetAnchors(root, "downloadWin", urls.win);
}
