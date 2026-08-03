// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RELEASES_URL,
  WINDOWS_FALLBACK_URL,
  upgradeReleaseLinks,
} from "./download-links.js";

const DMG_URL =
  "https://github.com/mxrsv/spacevibe-deck/releases/download/v0.9.0/SpaceVibe.Deck_0.9.0_universal.dmg";
const EXE_URL =
  "https://github.com/mxrsv/spacevibe-deck/releases/download/v0.9.0-windows-preview/SpaceVibe.Deck_0.9.0_x64-setup.exe";

// Newest-first, like the API: the Windows preview prerelease sits above the
// stable macOS release.
const RELEASES = [
  {
    tag_name: "v0.9.0-windows-preview",
    name: "Windows preview",
    body: "Windows preview notes",
    html_url:
      "https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.9.0-windows-preview",
    published_at: "2026-07-31T08:00:00Z",
    prerelease: true,
    assets: [
      {
        name: "SpaceVibe.Deck_0.9.0_x64-setup.exe",
        browser_download_url: EXE_URL,
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
        name: "SpaceVibe.Deck_universal.app.tar.gz",
        browser_download_url: "x",
      },
      {
        name: "SpaceVibe.Deck_0.9.0_universal.dmg",
        browser_download_url: DMG_URL,
      },
    ],
  },
];

// Mirrors the page: hero and finale carry `data-copy` on an inner span, the
// footer on the anchor itself. The footer Releases link must stay untouched.
function renderFixture() {
  const root = document.createElement("main");
  root.innerHTML = `
    <a class="hero-mac" href="${RELEASES_URL}" target="_blank" rel="noreferrer">
      <span data-copy="downloadMac">Download for macOS</span>
    </a>
    <a class="hero-win" href="${WINDOWS_FALLBACK_URL}" target="_blank" rel="noreferrer">
      <span data-copy="downloadWin">Download for Windows</span>
      <span data-copy="winPreviewTag">preview</span>
    </a>
    <a class="footer-mac" href="${RELEASES_URL}" target="_blank" rel="noreferrer"
      data-copy="downloadMac">Download for macOS</a>
    <a class="releases" href="${WINDOWS_FALLBACK_URL}" target="_blank"
      data-copy="footerReleases">Releases</a>
    <a class="release-version" href="/landing-prototype/changelog/"
      data-release-version>v0.8.0</a>
  `;
  return root;
}

function stubFetch(payload) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => payload }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("upgradeReleaseLinks", () => {
  it("points macOS anchors at the .dmg and Windows at the setup .exe", async () => {
    stubFetch(RELEASES);
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    for (const cls of ["hero-mac", "footer-mac"]) {
      const anchor = root.querySelector(`a.${cls}`);
      expect(anchor.href).toBe(DMG_URL);
      expect(anchor.hasAttribute("target")).toBe(false);
    }
    const win = root.querySelector("a.hero-win");
    expect(win.href).toBe(EXE_URL);
    expect(win.hasAttribute("target")).toBe(false);
    expect(root.querySelector("[data-release-version]").textContent).toBe(
      "v0.9.0",
    );
  });

  it("leaves non-download anchors alone", async () => {
    stubFetch(RELEASES);
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    expect(root.querySelector("a.releases").href).toBe(WINDOWS_FALLBACK_URL);
  });

  it("never serves a prerelease .dmg to macOS", async () => {
    stubFetch([
      {
        prerelease: true,
        assets: [
          {
            name: "SpaceVibe.Deck_0.9.1_universal.dmg",
            browser_download_url: "nightly",
          },
        ],
      },
      ...RELEASES,
    ]);
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    expect(root.querySelector("a.hero-mac").href).toBe(DMG_URL);
  });

  it("keeps the page hrefs when the API call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    expect(root.querySelector("a.hero-mac").href).toBe(RELEASES_URL);
    expect(root.querySelector("a.hero-win").href).toBe(WINDOWS_FALLBACK_URL);
    expect(root.querySelector("a.hero-mac").getAttribute("target")).toBe(
      "_blank",
    );
    expect(root.querySelector("[data-release-version]").textContent).toBe(
      "v0.8.0",
    );
  });

  it("keeps the page hrefs on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => [] }),
    );
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    expect(root.querySelector("a.hero-mac").href).toBe(RELEASES_URL);
    expect(root.querySelector("a.hero-win").href).toBe(WINDOWS_FALLBACK_URL);
  });

  it("upgrades one platform even when the other has no asset", async () => {
    stubFetch([RELEASES[1]]);
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    expect(root.querySelector("a.hero-mac").href).toBe(DMG_URL);
    expect(root.querySelector("a.hero-win").href).toBe(WINDOWS_FALLBACK_URL);
  });
});
