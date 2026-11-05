// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The host stubs the rail's import graph needs, and a `DeckIcon` jsdom can draw.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../../terminal/file-drop", () => ({
  installFileDrop: vi.fn(async () => () => {}),
}));
vi.mock("../controls/deck-icon", () => ({
  CHROME_ICON: 13,
  GLYPH_INLINE: 12,
  GLYPH_ROW: 14,
  GLYPH_FEATURE: 16,
  ROW_ICON: 14,
  FEATURE_ICON: 15,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import { rememberedPaneId, type RememberedPane, type WindowRecord } from "../../lib/session-schema";
import type { RememberedResume } from "../../sessions/resume-session";
import {
  loadRememberedPanes,
  mergeFromRecord,
  remove,
  forget,
  rememberedPanes,
  resetRememberedPanes,
} from "../../terminal/remembered-panes";
import { setRailQuery } from "./project-rail-state";
import {
  click,
  headers,
  host,
  installRailHarness,
  MINUTE,
  mount,
  NOW,
  pinHost,
  rows,
  settle,
  text,
} from "./project-rail-test-kit";
import { createRememberedPress } from "./remembered-press";

installRailHarness();

beforeEach(() => {
  pinHost(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => resetRememberedPanes());

const MAIN = "/r/.git";
const NOTES = "plain:/w/notes";

function remembered(
  over: Partial<RememberedPane> & { agent: string; cwd: string },
): RememberedPane {
  return {
    id: rememberedPaneId(over.agent, over.cwd),
    workspacePath: over.cwd,
    launchCommand: null,
    title: null,
    branch: null,
    sessionId: null,
    savedAt: NOW - 5 * MINUTE,
    ...over,
  };
}

const LAST_TOKEN = remembered({ agent: "claude", cwd: "/r/side", title: "token refresh" });
const NOTES_CODEX = remembered({ agent: "codex", cwd: "/w/notes" });

const rememberedRows = () =>
  [...host.querySelectorAll<HTMLElement>("[data-remembered]")].map((element) => ({
    element,
    button: element.querySelector<HTMLElement>("[data-rail-row]"),
  }));
const section = (key: string) =>
  host.querySelector<HTMLElement>(`[data-rail-project="${key}"]`)?.closest("section") ?? null;

describe("remembered rows on the project rail", () => {
  it("draws a row under its own project, after that project's live rows, with the checkout's branch", async () => {
    mount({ remembered: { panes: [LAST_TOKEN], onResume: vi.fn(), onForget: vi.fn() } });
    await settle();

    const own = rememberedRows();
    expect(own).toHaveLength(1);
    const main = section(MAIN);
    expect(main?.contains(own[0].element)).toBe(true);
    // Live rows first, then the dimmed one.
    const inProject = [...(main?.querySelectorAll("[data-rail-row]") ?? [])];
    expect(inProject.at(-1)).toBe(own[0].button);
    expect(inProject.length).toBeGreaterThan(1);
    const content = text(own[0].element);
    expect(content).toContain("token refresh");
    expect(content).toContain("side");
    expect(content).toContain("5m");
  });

  it("names a row without a title after its agent", async () => {
    mount({
      remembered: {
        panes: [remembered({ agent: "claude", cwd: "/r/main" })],
        onResume: vi.fn(),
        onForget: vi.fn(),
      },
    });
    await settle();

    expect(text(rememberedRows()[0].element)).toContain("Claude");
  });

  it("shows a project that has only remembered rows, at zero tabs, and no branch for a plain folder", async () => {
    mount({ remembered: { panes: [NOTES_CODEX], onResume: vi.fn(), onForget: vi.fn() } });
    await settle();

    const notes = section(NOTES);
    expect(notes?.querySelectorAll("[data-rail-row]")).toHaveLength(1);
    expect(text(notes)).not.toContain("No sessions");
    expect(notes?.querySelector("[data-remembered]")?.textContent).toContain("Codex");
    expect(notes?.querySelector('[data-remembered] [data-deck-icon-size="12"]')).toBeNull();
  });

  it("swaps the age for a resume mark on hover or focus, and lays a forget button beside it", async () => {
    mount({ remembered: { panes: [LAST_TOKEN], onResume: vi.fn(), onForget: vi.fn() } });
    await settle();

    const { element } = rememberedRows()[0];
    const age = [...element.querySelectorAll("span")]
      .filter((span) => span.textContent === "5m")
      .at(-1);
    const mark = element.querySelector("[data-resume-mark]");
    // One grid cell holds both, so the swap moves nothing (RCP-18).
    expect(age?.className).toContain("group-hover/item:invisible");
    expect(mark?.className).toContain("group-hover/item:visible");
    expect(age?.parentElement).toBe(mark?.parentElement);
    expect(element.querySelector('button[aria-label="Forget token refresh"]')).not.toBeNull();
  });

  it("is dimmed for the arrow keys and not a Tab stop", async () => {
    mount({ remembered: { panes: [LAST_TOKEN], onResume: vi.fn(), onForget: vi.fn() } });
    await settle();

    expect(rememberedRows()[0].button?.tabIndex).toBe(-1);
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
  });

  it("draws nothing when no remembered list is wired, the stage launcher being off", async () => {
    mount();
    await settle();

    expect(rememberedRows()).toHaveLength(0);
    expect(headers().length).toBeGreaterThan(0);
  });

  it("follows the rail search", async () => {
    mount({ remembered: { panes: [LAST_TOKEN], onResume: vi.fn(), onForget: vi.fn() } });
    await settle();

    act(() => setRailQuery("zzzz"));
    expect(rememberedRows()).toHaveLength(0);
  });
});

/** The real store, seeded as boot would: one record with two panes, on a fake `session.json`. */
async function seedStore(panes: readonly RememberedPane[]) {
  const data = new Map<string, unknown>();
  const store = {
    loadState: { state: "ready", fresh: false },
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: unknown) => void data.set(key, value)),
    save: vi.fn(async () => {}),
  } as unknown as NonNullable<Parameters<typeof loadRememberedPanes>[0]>["store"];
  await loadRememberedPanes({ store });
  const record: WindowRecord = {
    savedAt: NOW - 5 * MINUTE,
    activeTabIndex: 0,
    files: [],
    activeFileTab: null,
    agentBoardOpen: false,
    agentBoardSurfaceActive: false,
    tabs: panes.map((pane) => ({
      workspacePath: pane.workspacePath,
      layout: { type: "leaf" },
      name: pane.title,
      dotColor: null,
      panes: [
        {
          cwd: pane.cwd,
          agent: pane.agent,
          launchCommand: null,
          taskPrompt: null,
          sessionId: null,
        },
      ],
    })),
  };
  await mergeFromRecord(record);
  return { data };
}

const stored = (data: Map<string, unknown>) =>
  (data.get("remembered") as readonly RememberedPane[]).map((pane) => pane.id);

describe("pressing and forgetting a remembered row", () => {
  const rail = () => ({
    panes: rememberedPanes.value,
    onResume: (pane: RememberedPane) => void press(pane),
    onForget: (pane: RememberedPane) => void forget(pane.id),
  });
  let press: (pane: RememberedPane) => Promise<void>;
  const resume = vi.fn<(pane: RememberedPane) => Promise<RememberedResume>>();
  const startFresh = vi.fn();
  const notify = vi.fn();

  beforeEach(() => {
    resume.mockReset();
    startFresh.mockReset();
    notify.mockReset();
    press = createRememberedPress({ resume, startFresh, remove, notify });
  });

  const rowFor = (pane: RememberedPane) =>
    host.querySelector<HTMLElement>(`[data-rail-row="remembered:${pane.id}"]`);

  it("forgets the entry from the store with the ✕", async () => {
    const { data } = await seedStore([LAST_TOKEN, NOTES_CODEX]);
    mount({ remembered: rail() });
    await settle();

    click(host.querySelector('button[aria-label="Forget token refresh"]'));
    await settle();

    expect(rememberedPanes.value.map((pane) => pane.id)).toEqual([NOTES_CODEX.id]);
    expect(stored(data)).toEqual([NOTES_CODEX.id]);
  });

  it("resumes on a press and removes only that entry once it resumed", async () => {
    const { data } = await seedStore([LAST_TOKEN, NOTES_CODEX]);
    resume.mockResolvedValue({ status: "resumed" });
    mount({ remembered: rail() });
    await settle();

    click(rowFor(LAST_TOKEN));
    await settle();

    expect(resume).toHaveBeenCalledOnce();
    expect(resume.mock.calls[0][0].id).toBe(LAST_TOKEN.id);
    expect(stored(data)).toEqual([NOTES_CODEX.id]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("starts fresh when the conversation cannot be found, removes the entry and says so", async () => {
    const { data } = await seedStore([LAST_TOKEN]);
    resume.mockResolvedValue({ status: "fresh", command: "claude --model opus" });
    startFresh.mockResolvedValue({ ok: true });
    mount({ remembered: rail() });
    await settle();

    click(rowFor(LAST_TOKEN));
    await settle();

    expect(startFresh).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: LAST_TOKEN.id }),
      "claude --model opus",
    );
    expect(stored(data)).toEqual([]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("fresh"));
  });

  it("keeps the row and says why when the fresh start does not open", async () => {
    const { data } = await seedStore([LAST_TOKEN]);
    resume.mockResolvedValue({ status: "fresh", command: null });
    startFresh.mockResolvedValue({ ok: false, message: "This agent is no longer available." });
    mount({ remembered: rail() });
    await settle();

    click(rowFor(LAST_TOKEN));
    await settle();

    expect(stored(data)).toEqual([LAST_TOKEN.id]);
    expect(notify).toHaveBeenCalledWith("This agent is no longer available.");
  });

  it("keeps the row and says why when the folder is gone", async () => {
    const { data } = await seedStore([LAST_TOKEN]);
    resume.mockResolvedValue({ status: "failed", reason: "cwd-missing" });
    mount({ remembered: rail() });
    await settle();

    click(rowFor(LAST_TOKEN));
    await settle();

    expect(startFresh).not.toHaveBeenCalled();
    expect(stored(data)).toEqual([LAST_TOKEN.id]);
    expect(notify).toHaveBeenCalledWith("That folder no longer exists.");
  });

  it("resumes once when the row is pressed twice before the first resolves", async () => {
    await seedStore([LAST_TOKEN]);
    let finish: (value: RememberedResume) => void = () => {};
    resume.mockReturnValue(new Promise<RememberedResume>((resolve) => (finish = resolve)));
    mount({ remembered: rail() });
    await settle();

    click(rowFor(LAST_TOKEN));
    click(rowFor(LAST_TOKEN));
    finish({ status: "resumed" });
    await settle();

    expect(resume).toHaveBeenCalledOnce();
  });
});
