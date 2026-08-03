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

import {
  fetchPublishedReleases,
  latestStableTag,
  RELEASES_URL,
  REPO_URL,
  selectDownloadUrls,
  WINDOWS_FALLBACK_URL,
} from "./release-data.js";

export { RELEASES_URL, REPO_URL, WINDOWS_FALLBACK_URL };

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

export async function upgradeReleaseLinks(root) {
  let releases;

  try {
    releases = await fetchPublishedReleases();
  } catch {
    return;
  }

  const urls = selectDownloadUrls(releases);

  retargetAnchors(root, "downloadMac", urls.mac);
  retargetAnchors(root, "downloadWin", urls.win);

  const stableTag = latestStableTag(releases);

  if (stableTag) {
    for (const label of root.querySelectorAll("[data-release-version]")) {
      label.textContent = stableTag;
    }
  }
}
