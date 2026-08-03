import { describe, expect, it, vi } from "vitest";
import {
  fetchPublishedReleases,
  latestStableTag,
  normalizeReleases,
  selectDownloadUrls,
} from "./release-data.js";

const RELEASES = [
  {
    tag_name: "v0.10.0-windows-preview",
    name: "Windows preview",
    body: "Preview notes",
    html_url:
      "https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.10.0-windows-preview",
    published_at: "2026-08-03T08:00:00Z",
    prerelease: true,
    assets: [
      {
        name: "SpaceVibe.Deck_0.10.0_x64-setup.exe",
        browser_download_url:
          "https://github.com/mxrsv/spacevibe-deck/releases/download/v0.10.0-windows-preview/SpaceVibe.Deck_0.10.0_x64-setup.exe",
      },
    ],
  },
  {
    tag_name: "v0.9.0",
    name: "Deck 0.9.0",
    body: "Stable notes",
    html_url:
      "https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.9.0",
    published_at: "2026-07-27T08:00:00Z",
    prerelease: false,
    assets: [
      {
        name: "SpaceVibe.Deck_0.9.0_universal.dmg",
        browser_download_url:
          "https://github.com/mxrsv/spacevibe-deck/releases/download/v0.9.0/SpaceVibe.Deck_0.9.0_universal.dmg",
      },
    ],
  },
];

describe("normalizeReleases", () => {
  it("returns validated immutable release records without changing source data", () => {
    const source = structuredClone(RELEASES);
    const normalized = normalizeReleases(source);

    expect(normalized).toEqual([
      expect.objectContaining({
        tag: "v0.10.0-windows-preview",
        title: "Windows preview",
        prerelease: true,
      }),
      expect.objectContaining({
        tag: "v0.9.0",
        title: "Deck 0.9.0",
        prerelease: false,
      }),
    ]);
    expect(normalized[0]).not.toBe(source[0]);
    expect(source).toEqual(RELEASES);
  });

  it("drops malformed releases and unsafe asset URLs", () => {
    const normalized = normalizeReleases([
      null,
      {},
      {
        ...RELEASES[1],
        assets: [
          ...RELEASES[1].assets,
          { name: "unsafe.dmg", browser_download_url: "javascript:alert(1)" },
        ],
      },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].assets).toEqual(RELEASES[1].assets);
  });
});

describe("release selection", () => {
  it("uses the latest stable tag and platform-specific asset rules", () => {
    const releases = normalizeReleases(RELEASES);

    expect(latestStableTag(releases)).toBe("v0.9.0");
    expect(selectDownloadUrls(releases)).toEqual({
      mac: RELEASES[1].assets[0].browser_download_url,
      win: RELEASES[0].assets[0].browser_download_url,
    });
  });
});

describe("fetchPublishedReleases", () => {
  it("normalizes a successful API response", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => RELEASES,
    });

    await expect(fetchPublishedReleases(fetcher)).resolves.toEqual(
      normalizeReleases(RELEASES),
    );
  });

  it("rejects non-array payloads", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "rate limited" }),
    });

    await expect(fetchPublishedReleases(fetcher)).rejects.toThrow(
      "GitHub Releases response is not a list.",
    );
  });
});
