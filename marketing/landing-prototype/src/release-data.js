export const REPO_URL = "https://github.com/mxrsv/spacevibe-deck";
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const WINDOWS_FALLBACK_URL = `${REPO_URL}/releases`;
export const CHANGELOG_URL = "/landing-prototype/changelog/";

const RELEASES_API =
  "https://api.github.com/repos/mxrsv/spacevibe-deck/releases?per_page=100";
const RELEASE_PATH = "/mxrsv/spacevibe-deck/releases/";
const INSTALLER_SUFFIXES = [".dmg", ".exe"];

function trustedGithubUrl(value, pathPrefix) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith(pathPrefix)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function normalizeAsset(asset) {
  if (!asset || typeof asset.name !== "string") {
    return null;
  }

  const url = trustedGithubUrl(
    asset.browser_download_url,
    `${RELEASE_PATH}download/`,
  );

  if (!url) {
    return null;
  }

  const downloadCount = Number.isSafeInteger(asset.download_count) &&
    asset.download_count >= 0
    ? asset.download_count
    : 0;

  return {
    name: asset.name,
    browser_download_url: url,
    downloadCount,
  };
}

function normalizeDate(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return null;
  }

  return value;
}

function normalizeRelease(release) {
  const tag =
    typeof release?.tag_name === "string" ? release.tag_name.trim() : "";

  if (!tag) {
    return null;
  }

  const fallbackUrl = `${REPO_URL}/releases/tag/${encodeURIComponent(tag)}`;
  const assets = Array.isArray(release.assets)
    ? release.assets.map(normalizeAsset).filter(Boolean)
    : [];

  return {
    tag,
    title:
      typeof release.name === "string" && release.name.trim()
        ? release.name.trim()
        : tag,
    body: typeof release.body === "string" ? release.body.trim() : "",
    url: trustedGithubUrl(release.html_url, RELEASE_PATH) ?? fallbackUrl,
    publishedAt: normalizeDate(release.published_at),
    prerelease: release.prerelease === true,
    assets,
  };
}

export function normalizeReleases(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map(normalizeRelease).filter(Boolean);
}

export async function fetchPublishedReleases(fetcher = globalThis.fetch) {
  if (typeof fetcher !== "function") {
    throw new Error("GitHub Releases fetch is unavailable.");
  }

  const response = await fetcher(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok) {
    throw new Error(`GitHub Releases request failed (${response.status ?? "unknown"}).`);
  }

  const payload = await response.json();

  if (!Array.isArray(payload)) {
    throw new Error("GitHub Releases response is not a list.");
  }

  return normalizeReleases(payload);
}

export function latestStableTag(releases) {
  return releases.find((release) => !release.prerelease)?.tag ?? null;
}

function assetUrl(release, suffix) {
  return (
    release.assets.find((asset) => asset.name.endsWith(suffix))
      ?.browser_download_url ?? null
  );
}

export function selectDownloadUrls(releases) {
  const mac =
    releases
      .filter((release) => !release.prerelease)
      .map((release) => assetUrl(release, ".dmg"))
      .find(Boolean) ?? null;
  const win =
    releases.map((release) => assetUrl(release, ".exe")).find(Boolean) ?? null;

  return { mac, win };
}

export function totalInstallerDownloads(releases) {
  return releases
    .flatMap((release) => release.assets)
    .filter((asset) => {
      const name = asset.name.toLowerCase();
      return INSTALLER_SUFFIXES.some((suffix) => name.endsWith(suffix));
    })
    .reduce((total, asset) => total + asset.downloadCount, 0);
}
