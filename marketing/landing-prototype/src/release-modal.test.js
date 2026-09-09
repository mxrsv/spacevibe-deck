import { describe, expect, it } from "vitest";
import {
  displayVersion,
  isReleaseModalForced,
  RELEASE_SEEN_KEY,
  selectReleaseAnnouncement,
} from "./release-modal.js";

const PRERELEASE = {
  tag: "v1.2.0-preview",
  url: "https://github.com/mxrsv/spacevibe-deck/releases/tag/v1.2.0-preview",
  prerelease: true,
};
const STABLE = {
  tag: "v1.1.0",
  url: "https://github.com/mxrsv/spacevibe-deck/releases/tag/v1.1.0",
  prerelease: false,
};
const OLDER = {
  tag: "v1.0.0",
  url: "https://github.com/mxrsv/spacevibe-deck/releases/tag/v1.0.0",
  prerelease: false,
};

function memoryStorage(seed = {}) {
  const values = { ...seed };

  return {
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

function hostileStorage() {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
}

describe("selectReleaseAnnouncement", () => {
  it("announces the newest stable release when nothing was acknowledged", () => {
    expect(
      selectReleaseAnnouncement([PRERELEASE, STABLE, OLDER], memoryStorage()),
    ).toEqual(STABLE);
  });

  it("stays quiet once that exact tag was acknowledged", () => {
    const storage = memoryStorage({ [RELEASE_SEEN_KEY]: "v1.1.0" });

    expect(selectReleaseAnnouncement([STABLE, OLDER], storage)).toBeNull();
  });

  it("announces again when a newer tag ships after the acknowledgement", () => {
    const storage = memoryStorage({ [RELEASE_SEEN_KEY]: "v1.0.0" });

    expect(selectReleaseAnnouncement([STABLE, OLDER], storage)).toEqual(STABLE);
  });

  it("never announces a prerelease", () => {
    expect(selectReleaseAnnouncement([PRERELEASE], memoryStorage())).toBeNull();
  });

  it("stays quiet on an empty or unusable release list", () => {
    expect(selectReleaseAnnouncement([], memoryStorage())).toBeNull();
    expect(selectReleaseAnnouncement(null, memoryStorage())).toBeNull();
  });

  it("stays quiet when the dismissal cannot be remembered", () => {
    // No storage at all, and storage that throws, both mean an undismissable
    // notice on every load — worse than a missing one.
    expect(selectReleaseAnnouncement([STABLE], null)).toBeNull();
    expect(selectReleaseAnnouncement([STABLE], hostileStorage())).toBeNull();
  });

  it("forces the notice past an acknowledged tag for review", () => {
    const storage = memoryStorage({ [RELEASE_SEEN_KEY]: "v1.1.0" });

    expect(
      selectReleaseAnnouncement([STABLE], storage, { forced: true }),
    ).toEqual(STABLE);
  });
});

describe("isReleaseModalForced", () => {
  it("reads the review switch off the query string", () => {
    expect(isReleaseModalForced("?release-modal=1")).toBe(true);
    expect(isReleaseModalForced("?release-modal=0")).toBe(false);
    expect(isReleaseModalForced("?lang=en")).toBe(false);
    expect(isReleaseModalForced(undefined)).toBe(false);
  });
});

describe("displayVersion", () => {
  it("drops the tag's leading v so the headline sets a number", () => {
    expect(displayVersion("v1.1.0")).toBe("1.1.0");
    expect(displayVersion("1.1.0")).toBe("1.1.0");
  });
});
