import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ILink, Terminal } from "@xterm/xterm";
import { createLinkProvider } from "./link-provider";
import { createMemoryLinkClient } from "./link-client";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { pathOpenRequest, persistError } from "../chrome/events";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";

const CWD = "/repo";

/** Minimal Terminal stand-in: unwrapped rows of text. */
function fakeTerminalRows(rows: readonly string[]): Terminal {
  const cols = Math.max(...rows.map((row) => row.length));
  return {
    cols,
    buffer: {
      active: {
        getLine(y: number) {
          const text = rows[y];
          if (text === undefined) {
            return undefined;
          }
          return {
            isWrapped: false,
            getCell(x: number) {
              if (x >= cols) {
                return undefined;
              }
              const char = text[x] ?? " ";
              return {
                getChars: () => (char === " " ? "" : char),
                getWidth: () => 1,
              };
            },
          };
        },
      },
    },
  } as unknown as Terminal;
}

/** One unwrapped row — the shape most of these tests need. */
function fakeTerminal(text: string): Terminal {
  return fakeTerminalRows([text]);
}

function provide(
  term: Terminal,
  client: ReturnType<typeof createMemoryLinkClient>,
) {
  const provider = createLinkProvider(term, {
    getCwd: () => CWD,
    client,
  });
  return new Promise<ILink[] | undefined>((resolve) => {
    provider.provideLinks(1, resolve);
  });
}

/** One provider, many rows — the shape the cross-line cases need. */
function providerFor(
  term: Terminal,
  client: ReturnType<typeof createMemoryLinkClient>,
) {
  const provider = createLinkProvider(term, { getCwd: () => CWD, client });
  return (row: number) =>
    new Promise<ILink[] | undefined>((resolve) => {
      provider.provideLinks(row, resolve);
    });
}

function click(link: ILink, metaKey: boolean, ctrlKey = false): void {
  link.activate({ metaKey, ctrlKey } as MouseEvent, link.text);
}

describe("createLinkProvider", () => {
  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "macos",
      homeDir: "/Users/dev",
    });
    settings.value = DEFAULT_SETTINGS;
    persistError.value = null;
  });

  it("links a url and opens it in the browser on ⌘+click", async () => {
    const client = createMemoryLinkClient();
    const links = await provide(
      fakeTerminal("see https://example.com now"),
      client,
    );

    expect(links).toHaveLength(1);
    expect(links?.[0].text).toBe("https://example.com");
    click(links![0], true);
    expect(client.openedUrls).toEqual(["https://example.com"]);
    expect(client.openedEditor).toEqual([]);
  });

  it("ignores a plain click so the terminal keeps it", async () => {
    const client = createMemoryLinkClient();
    const links = await provide(
      fakeTerminal("see https://example.com now"),
      client,
    );

    click(links![0], false);
    expect(client.openedUrls).toEqual([]);
  });

  it("opens with Ctrl on Windows and ignores Cmd", async () => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const client = createMemoryLinkClient();
    const links = await provide(
      fakeTerminal("see https://example.com now"),
      client,
    );

    click(links![0], true);
    click(links![0], false, true);

    expect(client.openedUrls).toEqual(["https://example.com"]);
  });

  it("links only the paths that resolve to a real file", async () => {
    const client = createMemoryLinkClient({ files: [`${CWD}/src/foo.ts`] });
    const links = await provide(
      fakeTerminal("src/foo.ts and src/gone.ts"),
      client,
    );

    expect(links?.map((link) => link.text)).toEqual(["src/foo.ts"]);
  });

  // Since the 2026-08-19 path-open work the provider ROUTES nothing: it raises
  // one intent and `App` decides between Deck's own editor and an external app
  // (design §3.2). These cases therefore assert the intent, and the routing
  // itself is covered by `link-target.test.ts`.
  it("raises an open request carrying the line and column", async () => {
    const client = createMemoryLinkClient({ files: [`${CWD}/src/foo.ts`] });
    const links = await provide(
      fakeTerminal("at src/foo.ts:12:5 boom"),
      client,
    );

    click(links![0], true);
    expect(pathOpenRequest.value).toMatchObject({
      path: "/repo/src/foo.ts",
      line: 12,
      column: 5,
    });
    // Nothing is launched from here any more.
    expect(client.openedEditor).toEqual([]);
  });

  it("raises a fresh request for a second click on the same path", async () => {
    const client = createMemoryLinkClient({ files: [`${CWD}/src/foo.ts`] });
    const links = await provide(fakeTerminal("src/foo.ts:9"), client);

    click(links![0], true);
    const first = pathOpenRequest.value?.nonce ?? 0;
    // App clears the slot as soon as it has read it; a re-click has to be
    // distinguishable from the request that was just spent.
    pathOpenRequest.value = null;
    click(links![0], true);

    // `peek()` rather than `.value`: the assignment above narrows the
    // property's type to `null` for the rest of the block.
    expect(pathOpenRequest.peek()?.nonce ?? 0).toBeGreaterThan(first);
  });

  it("carries a null position for a path printed without one", async () => {
    const client = createMemoryLinkClient({ files: [`${CWD}/src/foo.ts`] });
    const links = await provide(fakeTerminal("src/foo.ts"), client);

    click(links![0], true);
    expect(pathOpenRequest.value).toMatchObject({
      path: "/repo/src/foo.ts",
      line: null,
      column: null,
    });
  });

  it("resolves a git diff header through its stripped spelling", async () => {
    // `a/src/foo.ts` is not a file; `src/foo.ts` is. Both go into one batch
    // and the candidate keeps the hit (design §2.2).
    const client = createMemoryLinkClient({ files: [`${CWD}/src/foo.ts`] });
    const links = await provide(
      fakeTerminal("--- a/src/foo.ts"),
      client,
    );

    expect(links).toHaveLength(1);
    click(links![0], true);
    expect(pathOpenRequest.value).toMatchObject({
      path: "/repo/src/foo.ts",
    });
  });

  it("prefers the verbatim spelling when both resolve", async () => {
    const client = createMemoryLinkClient({
      files: [`${CWD}/a/src/foo.ts`, `${CWD}/src/foo.ts`],
    });
    const links = await provide(fakeTerminal("--- a/src/foo.ts"), client);

    click(links![0], true);
    expect(pathOpenRequest.value).toMatchObject({
      path: "/repo/a/src/foo.ts",
    });
  });

  it("maps the link back onto its cells", async () => {
    const client = createMemoryLinkClient({ files: [`${CWD}/a.ts`] });
    const links = await provide(fakeTerminal("xx a.ts"), client);

    // "a.ts" sits at 0-based cells 3..6 — xterm ranges are 1-based inclusive.
    expect(links?.[0].range).toEqual({
      start: { x: 4, y: 1 },
      end: { x: 7, y: 1 },
    });
  });

  it("resolves each line only once", async () => {
    const client = createMemoryLinkClient({ files: [`${CWD}/a.ts`] });
    const spy = vi.spyOn(client, "resolvePaths");
    const term = fakeTerminal("xx a.ts");
    const provider = createLinkProvider(term, { getCwd: () => CWD, client });

    await new Promise<void>((done) => provider.provideLinks(1, () => done()));
    await new Promise<void>((done) => provider.provideLinks(1, () => done()));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("yields no links when resolution fails, and says why", async () => {
    const client = createMemoryLinkClient();
    vi.spyOn(client, "resolvePaths").mockRejectedValue(new Error("ipc down"));
    const links = await provide(fakeTerminal("src/foo.ts"), client);

    expect(links).toBeUndefined();
    // Without this the backend going down looks exactly like a detection bug:
    // every path stops being clickable while URLs keep working.
    expect(persistError.value).toMatch(/ipc down/);
  });

  it("retries a line whose paths did not resolve the first time", async () => {
    vi.useFakeTimers();
    try {
      const client = createMemoryLinkClient();
      const spy = vi
        .spyOn(client, "resolvePaths")
        .mockResolvedValue([null] as (string | null)[]);
      const term = fakeTerminal("xx a.ts");
      const provider = createLinkProvider(term, { getCwd: () => CWD, client });
      const hover = (): Promise<ILink[] | undefined> =>
        new Promise((resolve) => provider.provideLinks(1, resolve));

      expect(await hover()).toBeUndefined();

      // The file lands a moment later — a build, a `git add`. The line's text
      // never changes, so a miss cached for good would leave it dead forever.
      spy.mockResolvedValue([`${CWD}/a.ts`]);
      vi.advanceTimersByTime(6_000);

      expect((await hover())?.map((link) => link.text)).toEqual(["a.ts"]);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a reply the pointer has already moved past", async () => {
    const pending: ((value: (string | null)[]) => void)[] = [];
    const client = createMemoryLinkClient();
    vi.spyOn(client, "resolvePaths").mockImplementation(
      () =>
        new Promise<(string | null)[]>((resolve) => {
          pending.push(resolve);
        }),
    );
    const provider = createLinkProvider(fakeTerminalRows(["a.ts", "b.ts"]), {
      getCwd: () => CWD,
      client,
    });

    const stale = vi.fn();
    provider.provideLinks(1, stale);
    const current = vi.fn();
    provider.provideLinks(2, current);

    // Row 2 answers first, then row 1's slower reply lands. xterm files every
    // reply under the provider's index, so handing it the late one would wipe
    // the links of the row actually under the pointer.
    pending[1]([`${CWD}/b.ts`]);
    pending[0]([`${CWD}/a.ts`]);
    await vi.waitFor(() => expect(current).toHaveBeenCalledTimes(1));

    expect(stale).not.toHaveBeenCalled();
  });

  // Design §2.3 — the only grammar that needs more than one logical line.
  describe("ESLint's finding rows", () => {
    const REPORT = [
      "src/foo.ts",
      "  12:5   error    x  no-unused-vars",
      "  20:1   warning  y  semi",
      "",
      "src/bar.ts",
      "  12:5   error    x  no-unused-vars",
    ];

    it("links the position to the file named above it", async () => {
      const client = createMemoryLinkClient({
        files: [`${CWD}/src/foo.ts`, `${CWD}/src/bar.ts`],
      });
      const links = await providerFor(fakeTerminalRows(REPORT), client)(2);

      expect(links).toHaveLength(1);
      expect(links![0].text).toBe("12:5");
      click(links![0], true);
      expect(pathOpenRequest.value).toMatchObject({
        path: "/repo/src/foo.ts",
        line: 12,
        column: 5,
      });
    });

    it("does not hand the second file's rows the first file's document", async () => {
      // The two rows are byte-identical. A cache keyed by this line's text
      // alone would answer the second from the first — silently, and only
      // when a lint run repeats a finding.
      const client = createMemoryLinkClient({
        files: [`${CWD}/src/foo.ts`, `${CWD}/src/bar.ts`],
      });
      const provide = providerFor(fakeTerminalRows(REPORT), client);

      const first = await provide(2);
      click(first![0], true);
      expect(pathOpenRequest.value).toMatchObject({
        path: "/repo/src/foo.ts",
      });

      const second = await provide(6);
      click(second![0], true);
      expect(pathOpenRequest.value).toMatchObject({
        path: "/repo/src/bar.ts",
      });
    });

    it("leaves a position row alone when its header is not a file", async () => {
      const client = createMemoryLinkClient({ files: [] });
      const links = await providerFor(
        fakeTerminalRows(["Summary", "  12:5   error    x  rule"]),
        client,
      )(2);
      expect(links).toBeUndefined();
    });
  });
});
