// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { upgradeMacDownloadLinks } from "./download-links.js";

const RELEASES_PAGE = "https://github.com/mxrsv/spacevibe-deck/releases/latest";
const DMG_URL =
  "https://github.com/mxrsv/spacevibe-deck/releases/download/v0.9.0/SpaceVibe.Deck_0.9.0_universal.dmg";

// Mirrors the three shapes the page renders: hero and finale carry
// `data-copy="downloadMac"` on an inner span, the footer on the anchor itself.
function renderFixture() {
  const root = document.createElement("main");
  root.innerHTML = `
    <a class="hero" href="${RELEASES_PAGE}" target="_blank" rel="noreferrer">
      <span data-copy="downloadMac">Download for macOS</span>
    </a>
    <a class="finale" href="${RELEASES_PAGE}" target="_blank" rel="noreferrer">
      <span data-copy="downloadMac">Download for macOS</span>
    </a>
    <a class="footer" href="${RELEASES_PAGE}" target="_blank" rel="noreferrer"
      data-copy="downloadMac">Download for macOS</a>
    <button type="button" disabled><span data-copy="downloadWin">Download for Windows</span></button>
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

describe("upgradeMacDownloadLinks", () => {
  it("points every macOS anchor at the .dmg asset and drops target", async () => {
    stubFetch({
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
    });
    const root = renderFixture();

    await upgradeMacDownloadLinks(root);

    for (const cls of ["hero", "finale", "footer"]) {
      const anchor = root.querySelector(`a.${cls}`);
      expect(anchor.href).toBe(DMG_URL);
      expect(anchor.hasAttribute("target")).toBe(false);
    }
  });

  it("keeps the releases-page href when the API call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const root = renderFixture();

    await upgradeMacDownloadLinks(root);

    expect(root.querySelector("a.hero").href).toBe(RELEASES_PAGE);
    expect(root.querySelector("a.hero").getAttribute("target")).toBe("_blank");
  });

  it("keeps the releases-page href when no .dmg asset exists", async () => {
    stubFetch({
      assets: [
        {
          name: "SpaceVibe.Deck_0.9.0_x64-setup.exe",
          browser_download_url: "x",
        },
      ],
    });
    const root = renderFixture();

    await upgradeMacDownloadLinks(root);

    expect(root.querySelector("a.hero").href).toBe(RELEASES_PAGE);
  });

  it("keeps the releases-page href on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    const root = renderFixture();

    await upgradeMacDownloadLinks(root);

    expect(root.querySelector("a.hero").href).toBe(RELEASES_PAGE);
  });
});
