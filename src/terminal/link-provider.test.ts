import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ILink, Terminal } from "@xterm/xterm";
import { createLinkProvider } from "./link-provider";
import { createMemoryLinkClient } from "./link-client";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { persistError } from "../chrome/events";

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

function click(link: ILink, metaKey: boolean): void {
  link.activate({ metaKey } as MouseEvent, link.text);
}

describe("createLinkProvider", () => {
  beforeEach(() => {
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

  it("links only the paths that resolve to a real file", async () => {
    const client = createMemoryLinkClient({ files: [`${CWD}/src/foo.ts`] });
    const links = await provide(
      fakeTerminal("src/foo.ts and src/gone.ts"),
      client,
    );

    expect(links?.map((link) => link.text)).toEqual(["src/foo.ts"]);
  });

  it("opens the resolved file at its line and column", async () => {
    const client = createMemoryLinkClient({ files: [`${CWD}/src/foo.ts`] });
    const links = await provide(
      fakeTerminal("at src/foo.ts:12:5 boom"),
      client,
    );

    click(links![0], true);
    expect(client.openedEditor).toEqual(["code -g /repo/src/foo.ts:12:5"]);
  });

  it("uses the configured custom editor command", async () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      editorId: "custom",
      editorCommand: "vim +{line} {file}",
    };
    const client = createMemoryLinkClient({ files: [`${CWD}/src/foo.ts`] });
    const links = await provide(fakeTerminal("src/foo.ts:9"), client);

    click(links![0], true);
    expect(client.openedEditor).toEqual(["vim +9 /repo/src/foo.ts"]);
  });

  it("surfaces an error when the custom editor command is blank", async () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      editorId: "custom",
      editorCommand: "",
    };
    const client = createMemoryLinkClient({ files: [`${CWD}/src/foo.ts`] });
    const links = await provide(fakeTerminal("src/foo.ts"), client);

    click(links![0], true);
    expect(client.openedEditor).toEqual([]);
    expect(persistError.value).toMatch(/No editor command/);
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
});
