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
 * 2026-08-17, for the Windows Electron release: the page carries no macOS
 * ANCHOR right now — the macOS control is a disabled button until the Electron
 * macOS build ships, so nothing matches the `downloadMac` retarget and the old
 * Tauri .dmg is never handed out. The call below stays because restoring macOS
 * is then a markup change alone: turn the button back into an anchor.
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

function setDownloadProofState(root, state, count = null) {
  for (const proof of root.querySelectorAll("[data-download-proof]")) {
    const countLabel = proof.querySelector("[data-download-count]");

    proof.dataset.downloadState = state;

    if (countLabel && count !== null) {
      countLabel.textContent = new Intl.NumberFormat("en-US").format(count);
    }

    for (const label of proof.querySelectorAll("[data-download-loading]")) {
      label.hidden = state !== "loading";
    }

    for (const label of proof.querySelectorAll("[data-download-ready]")) {
      label.hidden = state !== "ready";
    }

    for (const label of proof.querySelectorAll("[data-download-unavailable]")) {
      label.hidden = state !== "unavailable";
    }
  }
}

export async function upgradeReleaseLinks(root) {
  let releases;

  try {
    releases = await fetchPublishedReleases();
  } catch {
    setDownloadProofState(root, "unavailable");
    return;
  }

  const urls = selectDownloadUrls(releases);

  retargetAnchors(root, "downloadMac", urls.mac);
  retargetAnchors(root, "downloadWin", urls.win);
  setDownloadProofState(root, "ready", totalInstallerDownloads(releases));

  const stableTag = latestStableTag(releases);

  if (stableTag) {
    for (const label of root.querySelectorAll("[data-release-version]")) {
      label.textContent = stableTag;
    }
  }
}
