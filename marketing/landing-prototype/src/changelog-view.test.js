// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  renderChangelogShell,
  renderReleaseError,
  renderReleaseList,
  updateChangelogLocale,
} from "./changelog-view.js";

const COPY = {
  en: {
    navProduct: "Deck",
    localeLabel: "Language",
    changelogBack: "Back to Deck",
    changelogKicker: "// release ledger",
    changelogTitle: "Changelog",
    changelogIntro: "Every published build, newest first.",
    changelogLoading: "Loading published releases…",
    changelogEmpty: "No published releases yet.",
    changelogError: "Could not load releases.",
    changelogRetry: "Try again",
    changelogPreview: "Preview",
    changelogNoNotes: "No release notes were published.",
    changelogViewRelease: "View release",
  },
  vi: {
    navProduct: "Deck",
    localeLabel: "Ngôn ngữ",
    changelogBack: "Về trang Deck",
    changelogKicker: "// nhật ký phát hành",
    changelogTitle: "Thay đổi",
    changelogIntro: "Mọi bản đã phát hành, mới nhất trước.",
    changelogLoading: "Đang tải các bản phát hành…",
    changelogEmpty: "Chưa có bản phát hành nào.",
    changelogError: "Không tải được bản phát hành.",
    changelogRetry: "Thử lại",
    changelogPreview: "Thử nghiệm",
    changelogNoNotes: "Bản phát hành này không có ghi chú.",
    changelogViewRelease: "Xem bản phát hành",
  },
};

const RELEASES = [
  {
    tag: "v0.9.1-windows-preview",
    title: "Windows preview",
    body: "Preview notes",
    url: "https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.9.1-windows-preview",
    publishedAt: "2026-08-03T08:00:00Z",
    prerelease: true,
    assets: [],
  },
  {
    tag: "v0.9.0",
    title: "Deck 0.9.0",
    body: "Stable notes",
    url: "https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.9.0",
    publishedAt: "2026-07-27T08:00:00Z",
    prerelease: false,
    assets: [],
  },
];

let root;

beforeEach(() => {
  root = document.createElement("main");
  renderChangelogShell(root, COPY.en, "en");
});

describe("renderReleaseList", () => {
  it("renders stable and prerelease entries newest-first", () => {
    renderReleaseList(root, RELEASES, COPY.en, "en");

    const articles = [...root.querySelectorAll("article")];
    expect(articles.map((article) => article.dataset.releaseTag)).toEqual([
      "v0.9.1-windows-preview",
      "v0.9.0",
    ]);
    expect(articles[0].querySelector("[data-copy='changelogPreview']").textContent).toBe(
      "Preview",
    );
    expect(articles[1].querySelector("[data-copy='changelogPreview']")).toBeNull();
  });

  it("renders release notes as inert text", () => {
    renderReleaseList(
      root,
      [
        {
          ...RELEASES[1],
          body: '<img src=x onerror="window.compromised=true">',
        },
      ],
      COPY.en,
      "en",
    );

    expect(root.querySelector(".changelog-release__notes").textContent).toContain(
      "<img src=x",
    );
    expect(root.querySelector(".changelog-release__notes img")).toBeNull();
  });

  it("formats common release-note Markdown with safe DOM nodes", () => {
    renderReleaseList(
      root,
      [
        {
          ...RELEASES[1],
          body:
            "**Unsigned** build\n\n## Details\n- Installer\n- SHA256: `abc123`\n- See [stable](https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.9.0)",
        },
      ],
      COPY.en,
      "en",
    );

    const notes = root.querySelector(".changelog-release__notes");
    expect(notes.querySelector("strong").textContent).toBe("Unsigned");
    expect(notes.querySelector("h3").textContent).toBe("Details");
    expect([...notes.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "Installer",
      "SHA256: abc123",
      "See stable",
    ]);
    expect(notes.querySelector("code").textContent).toBe("abc123");
    expect(notes.querySelector("a").href).toBe(
      "https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.9.0",
    );
    expect(notes.textContent).not.toContain("**");
    expect(notes.textContent).not.toContain("##");
  });

  it("shows the empty state when no releases are published", () => {
    renderReleaseList(root, [], COPY.en, "en");

    expect(root.dataset.releaseState).toBe("empty");
    expect(root.querySelector("[data-release-status]").textContent).toBe(
      COPY.en.changelogEmpty,
    );
  });
});

describe("release failure and locale", () => {
  it("renders a recoverable error state", () => {
    renderReleaseError(root, COPY.en);

    expect(root.dataset.releaseState).toBe("error");
    expect(root.querySelector("button[data-release-retry]").textContent).toBe(
      COPY.en.changelogRetry,
    );
  });

  it("updates changelog chrome when the locale changes", () => {
    renderReleaseList(root, RELEASES, COPY.en, "en");
    updateChangelogLocale(root, COPY.vi, "vi");

    expect(root.querySelector("[data-copy='changelogTitle']").textContent).toBe(
      COPY.vi.changelogTitle,
    );
    expect(root.querySelector("[data-copy='changelogPreview']").textContent).toBe(
      COPY.vi.changelogPreview,
    );
    expect(root.querySelector("time").getAttribute("lang")).toBe("vi");
  });
});
