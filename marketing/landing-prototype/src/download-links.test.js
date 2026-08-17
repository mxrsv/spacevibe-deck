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
        download_count: 12,
        browser_download_url: EXE_URL,
      },
    ],
  },
  {
    tag_name: "v0.9.0",
    name: "Deck 0.9.0",
    body: "Stable notes",
    html_url: "https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.9.0",
    published_at: "2026-07-27T08:00:00Z",
    prerelease: false,
    assets: [
      {
        name: "SpaceVibe.Deck_universal.app.tar.gz",
        download_count: 500,
        browser_download_url: "x",
      },
      {
        name: "SpaceVibe.Deck_0.9.0_universal.dmg",
        download_count: 5,
        browser_download_url: DMG_URL,
      },
    ],
  },
];

// Mirrors the page: hero and finale carry `data-copy` on an inner span, the
// footer on the anchor itself. The footer Releases link must stay untouched.
// The macOS control is a disabled button while the Electron macOS build is
// unreleased — it carries `downloadMac` but is deliberately not an anchor.
function renderFixture() {
  const root = document.createElement("main");
  root.innerHTML = `
    <a class="hero-win" href="${WINDOWS_FALLBACK_URL}" target="_blank" rel="noreferrer">
      <span data-copy="downloadWin">Download for Windows</span>
      <span data-copy="winPreviewTag">preview</span>
    </a>
    <button class="hero-mac" type="button" disabled>
      <span data-copy="downloadMac">Download for macOS</span>
      <span data-copy="comingSoon">coming soon</span>
    </button>
    <a class="footer-win" href="${WINDOWS_FALLBACK_URL}" target="_blank" rel="noreferrer"
      data-copy="downloadWin">Download for Windows</a>
    <a class="releases" href="${RELEASES_URL}" target="_blank"
      data-copy="footerReleases">Releases</a>
    <a class="release-version" href="/landing-prototype/changelog/"
      data-release-version>v0.8.0</a>
    <aside data-download-proof data-download-state="loading">
      <strong data-download-count>—</strong>
      <span data-download-loading>Checking GitHub Releases</span>
      <span data-download-ready hidden>GitHub Releases</span>
      <span data-download-unavailable hidden>Count unavailable</span>
    </aside>
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
  it("points every Windows anchor at the setup .exe", async () => {
    stubFetch(RELEASES);
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    for (const cls of ["hero-win", "footer-win"]) {
      const anchor = root.querySelector(`a.${cls}`);
      expect(anchor.href).toBe(EXE_URL);
      expect(anchor.hasAttribute("target")).toBe(false);
    }
    expect(root.querySelector("[data-release-version]").textContent).toBe(
      "v0.9.0",
    );
    expect(
      root.querySelector("[data-download-proof]").dataset.downloadState,
    ).toBe("ready");
    expect(root.querySelector("[data-download-count]").textContent).toBe("17");
    expect(root.querySelector("[data-download-loading]").hidden).toBe(true);
    expect(root.querySelector("[data-download-ready]").hidden).toBe(false);
  });

  it("leaves non-download anchors alone", async () => {
    stubFetch(RELEASES);
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    expect(root.querySelector("a.releases").href).toBe(RELEASES_URL);
  });

  // The whole point of the coming-soon control being a <button>: a live .dmg
  // exists on a stable release, and nothing may quietly turn it into a link.
  it("never turns the coming-soon macOS control into a download", async () => {
    stubFetch(RELEASES);
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    const mac = root.querySelector(".hero-mac");
    expect(mac.tagName).toBe("BUTTON");
    expect(mac.hasAttribute("href")).toBe(false);
    expect(mac.disabled).toBe(true);
    expect(root.querySelector("a.hero-mac")).toBeNull();
  });

  it("keeps the page hrefs when the API call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    expect(root.querySelector("a.hero-win").href).toBe(WINDOWS_FALLBACK_URL);
    expect(root.querySelector("a.hero-win").getAttribute("target")).toBe(
      "_blank",
    );
    expect(root.querySelector("[data-release-version]").textContent).toBe(
      "v0.8.0",
    );
    expect(
      root.querySelector("[data-download-proof]").dataset.downloadState,
    ).toBe("unavailable");
    expect(root.querySelector("[data-download-count]").textContent).toBe("—");
    expect(root.querySelector("[data-download-loading]").hidden).toBe(true);
    expect(root.querySelector("[data-download-unavailable]").hidden).toBe(
      false,
    );
  });

  it("keeps the page hrefs on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => [] }),
    );
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    expect(root.querySelector("a.hero-win").href).toBe(WINDOWS_FALLBACK_URL);
  });

  it("keeps the releases page when no release carries an .exe", async () => {
    stubFetch([RELEASES[1]]);
    const root = renderFixture();

    await upgradeReleaseLinks(root);

    expect(root.querySelector("a.hero-win").href).toBe(WINDOWS_FALLBACK_URL);
    expect(root.querySelector("a.footer-win").href).toBe(WINDOWS_FALLBACK_URL);
  });
});
