import { describe, expect, it } from "vitest";
import type { DirEntry, Listings } from "./file-tree";
import { nextRevealStep, type RevealState, type RevealStep } from "./tree-reveal";

const dir = (path: string, outOfRoot = false): DirEntry => ({
  name: path.split(/[\\/]/).pop() ?? path,
  path,
  directory: true,
  outOfRoot,
});
const file = (path: string): DirEntry => ({
  name: path.split(/[\\/]/).pop() ?? path,
  path,
  directory: false,
  outOfRoot: false,
});

/** `list_dir` joins names onto the realpath'd directory, so under a symlinked
 * root (macOS `/tmp`) every entry path starts with `/private/tmp/ws`. */
const ROOT = "/tmp/ws";
const REAL = "/private/tmp/ws";

function listings(entries: Record<string, DirEntry[]>): Listings {
  return new Map(Object.entries(entries));
}

function state(overrides: Partial<RevealState> & Pick<RevealState, "target">): RevealState {
  return {
    root: ROOT,
    listings: new Map(),
    expanded: new Set(),
    rootExpanded: true,
    showHidden: false,
    listingErrors: new Map(),
    ...overrides,
  };
}

const step = (value: RevealStep): RevealStep => value;

/** root → src → a → deep.ts, every listing loaded. */
const DEEP = `${REAL}/src/a/deep.ts`;
const deepListings = (): Listings =>
  listings({
    [ROOT]: [dir(`${REAL}/src`), file(`${REAL}/README.md`)],
    [`${REAL}/src`]: [dir(`${REAL}/src/a`)],
    [`${REAL}/src/a`]: [file(DEEP)],
  });

describe("nextRevealStep", () => {
  it("opens the outermost closed folder first, one step at a time, from cached listings under a symlinked root", () => {
    const base = { target: DEEP, listings: deepListings() };

    expect(nextRevealStep(state({ ...base }))).toEqual(
      step({ kind: "expand", directory: `${REAL}/src` }),
    );
    expect(nextRevealStep(state({ ...base, expanded: new Set([`${REAL}/src`]) }))).toEqual(
      step({ kind: "expand", directory: `${REAL}/src/a` }),
    );
    expect(
      nextRevealStep(state({ ...base, expanded: new Set([`${REAL}/src`, `${REAL}/src/a`]) })),
    ).toEqual(step({ kind: "done" }));
  });

  it("never returns an ancestor already in `expanded`", () => {
    // `toggleDirectory` toggles: answering `src` here would collapse it.
    const result = nextRevealStep(
      state({ target: DEEP, listings: deepListings(), expanded: new Set([`${REAL}/src`]) }),
    );

    expect(result).toEqual({ kind: "expand", directory: `${REAL}/src/a` });
  });

  it("reaches a document directly under the root without opening anything", () => {
    expect(
      nextRevealStep(state({ target: `${REAL}/README.md`, listings: deepListings() })),
    ).toEqual({ kind: "done" });
  });

  it("matches Windows separators", () => {
    const root = "C:\\ws";
    const src = "C:\\ws\\src";
    const target = "C:\\ws\\src\\a.ts";
    const map = listings({ [root]: [dir(src)], [src]: [file(target)] });

    expect(nextRevealStep(state({ root, target, listings: map }))).toEqual({
      kind: "expand",
      directory: src,
    });
    expect(
      nextRevealStep(state({ root, target, listings: map, expanded: new Set([src]) })),
    ).toEqual({ kind: "done" });
  });

  it("does not take a sibling that merely shares a prefix for an ancestor", () => {
    const map = listings({ [ROOT]: [dir(`${REAL}/src`)], [`${REAL}/src`]: [] });

    expect(nextRevealStep(state({ target: `${REAL}/src2/a.ts`, listings: map }))).toEqual({
      kind: "none",
    });
  });

  describe("the root", () => {
    it("opens a collapsed root once the document is known to be inside it", () => {
      expect(
        nextRevealStep(state({ target: DEEP, listings: deepListings(), rootExpanded: false })),
      ).toEqual({ kind: "open-root" });
    });

    it("answers `none` before opening a collapsed root for a document outside it", () => {
      expect(
        nextRevealStep(
          state({ target: "/elsewhere/x.ts", listings: deepListings(), rootExpanded: false }),
        ),
      ).toEqual({ kind: "none" });
    });

    it("waits for an unlisted root rather than opening it blind", () => {
      expect(nextRevealStep(state({ target: DEEP, rootExpanded: false }))).toEqual({
        kind: "wait",
        directory: ROOT,
      });
    });

    it("gives up on a root whose listing failed", () => {
      expect(
        nextRevealStep(state({ target: DEEP, listingErrors: new Map([[ROOT, "x"]]) })),
      ).toEqual({ kind: "none" });
    });

    it("never treats the root itself as a document", () => {
      expect(nextRevealStep(state({ target: ROOT, listings: deepListings() }))).toEqual({
        kind: "none",
      });
    });
  });

  describe("listings", () => {
    it("expands an unlisted ancestor, which is what loads it", () => {
      const map = listings({ [ROOT]: [dir(`${REAL}/src`)] });

      expect(nextRevealStep(state({ target: DEEP, listings: map }))).toEqual({
        kind: "expand",
        directory: `${REAL}/src`,
      });
    });

    it("waits on an open folder whose listing has not arrived", () => {
      const map = listings({ [ROOT]: [dir(`${REAL}/src`)] });

      expect(
        nextRevealStep(state({ target: DEEP, listings: map, expanded: new Set([`${REAL}/src`]) })),
      ).toEqual({ kind: "wait", directory: `${REAL}/src` });
    });

    it("gives up on an open folder whose listing failed", () => {
      const map = listings({ [ROOT]: [dir(`${REAL}/src`)] });

      expect(
        nextRevealStep(
          state({
            target: DEEP,
            listings: map,
            expanded: new Set([`${REAL}/src`]),
            listingErrors: new Map([[`${REAL}/src`, "x"]]),
          }),
        ),
      ).toEqual({ kind: "none" });
    });

    it("answers `none` when a loaded listing lacks the entry, before opening anything", () => {
      const map = listings({
        [ROOT]: [dir(`${REAL}/src`)],
        [`${REAL}/src`]: [file(`${REAL}/src/other.ts`)],
      });

      expect(nextRevealStep(state({ target: DEEP, listings: map }))).toEqual({ kind: "none" });
    });

    it("stops on a listing that names a folder inside itself", () => {
      const loop = `${REAL}/loop`;
      const map = listings({ [ROOT]: [dir(loop)], [loop]: [dir(loop)] });

      expect(nextRevealStep(state({ target: `${loop}/x.ts`, listings: map }))).toEqual({
        kind: "none",
      });
    });
  });

  describe("what the tree cannot show", () => {
    const hidden = (): Listings =>
      listings({
        [ROOT]: [dir(`${REAL}/.github`), dir(`${REAL}/node_modules`), file(`${REAL}/.env`)],
        [`${REAL}/.github`]: [dir(`${REAL}/.github/workflows`)],
        [`${REAL}/.github/workflows`]: [file(`${REAL}/.github/workflows/ci.yml`)],
        [`${REAL}/node_modules`]: [file(`${REAL}/node_modules/x.js`)],
      });

    it("answers `none` for a dot-path while hidden files are off", () => {
      expect(nextRevealStep(state({ target: `${REAL}/.env`, listings: hidden() }))).toEqual({
        kind: "none",
      });
      expect(
        nextRevealStep(state({ target: `${REAL}/.github/workflows/ci.yml`, listings: hidden() })),
      ).toEqual({ kind: "none" });
    });

    it("reveals the same dot-path once hidden files are on", () => {
      const target = `${REAL}/.github/workflows/ci.yml`;

      expect(nextRevealStep(state({ target, listings: hidden(), showHidden: true }))).toEqual({
        kind: "expand",
        directory: `${REAL}/.github`,
      });
      expect(
        nextRevealStep(
          state({
            target: `${REAL}/.env`,
            listings: hidden(),
            showHidden: true,
          }),
        ),
      ).toEqual({ kind: "done" });
    });

    it("never reveals under an excluded name, hidden files on or off", () => {
      for (const showHidden of [false, true]) {
        expect(
          nextRevealStep(
            state({ target: `${REAL}/node_modules/x.js`, listings: hidden(), showHidden }),
          ),
        ).toEqual({ kind: "none" });
      }
    });

    it("answers `none` for a document outside the root", () => {
      expect(nextRevealStep(state({ target: "/etc/hosts", listings: deepListings() }))).toEqual({
        kind: "none",
      });
    });

    it("answers `none` through a symlink that leaves the root", () => {
      const map = listings({
        [ROOT]: [dir(`${REAL}/escape`, true)],
        [`${REAL}/escape`]: [file(`${REAL}/escape/x.ts`)],
      });

      expect(nextRevealStep(state({ target: `${REAL}/escape/x.ts`, listings: map }))).toEqual({
        kind: "none",
      });
    });

    it("answers `none` when an ancestor is a file", () => {
      const map = listings({ [ROOT]: [file(`${REAL}/a.ts`)] });

      expect(nextRevealStep(state({ target: `${REAL}/a.ts/b`, listings: map }))).toEqual({
        kind: "none",
      });
    });
  });
});
