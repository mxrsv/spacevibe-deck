/**
 * Where the landing page sends people to get the app.
 *
 * The download anchors are server-rendered with releases *pages* — URLs that
 * never rot — and upgraded in place at load time: one call to the releases
 * API finds the newest Apple Silicon .dmg and Windows x64 installer on stable
 * releases. The list endpoint remains shared with the changelog and download
 * proof, while platform selection rejects prerelease installers.
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
  totalInstallerDownloads,
  WINDOWS_FALLBACK_URL,
} from "./release-data.js";

export { RELEASES_URL, REPO_URL, WINDOWS_FALLBACK_URL };

// The hero says "Install" while the finale/footer say "Download". All carry
// their locale key through `data-copy`; closest() covers both anchor shapes.
function retargetAnchors(root, copyKeys, url) {
  if (!url) {
    return;
  }

  for (const copyKey of copyKeys) {
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
}

function setDownloadProofState(root, state, count = null) {
  for (const proof of root.querySelectorAll("[data-download-proof]")) {
    const countLabel = proof.querySelector("[data-download-count]");

    proof.dataset.downloadState = state;

    if (countLabel && count !== null) {
      countLabel.textContent = new Intl.NumberFormat("en-US").format(count);
    }
  }
}

/**
 * Returns the normalized release list so a second consumer (the release
 * notice) can ride this one request rather than spending another against the
 * unauthenticated GitHub quota. Returns an empty list on any failure.
 */
export async function upgradeReleaseLinks(root) {
  let releases;

  try {
    releases = await fetchPublishedReleases();
  } catch {
    setDownloadProofState(root, "unavailable");
    return [];
  }

  const urls = selectDownloadUrls(releases);

  retargetAnchors(root, ["downloadMac", "installMac"], urls.mac);
  retargetAnchors(root, ["downloadWin", "installWin"], urls.win);
  setDownloadProofState(root, "ready", totalInstallerDownloads(releases));

  const stableTag = latestStableTag(releases);

  if (stableTag) {
    for (const label of root.querySelectorAll("[data-release-version]")) {
      label.textContent = stableTag;
    }
  }

  return releases;
}
