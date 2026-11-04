import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  state: "ready" as "ready" | "unreadable",
  data: new Map<string, unknown>(),
  load: vi.fn(),
}));

vi.mock("../../host/store-host", () => ({ Store: { load: fake.load } }));

import type { SessionPane, SessionTab, WindowRecord } from "../../lib/session-schema";
import { forget, rememberedPanes, resetRememberedPanes } from "../../terminal/remembered-panes";
import { seedRememberedPanes, shouldHoldRecord } from "./remembered-boot";

const pane = (over: Partial<SessionPane> = {}): SessionPane => ({
  cwd: "/w/a",
  agent: "claude",
  launchCommand: null,
  taskPrompt: null,
  ...over,
});
const tab = (panes: readonly SessionPane[]): SessionTab => ({
  workspacePath: "/w",
  layout: { type: "leaf" },
  panes,
  name: "login bug",
  dotColor: null,
});
const record = (tabs: readonly SessionTab[]): WindowRecord => ({
  savedAt: 100,
  activeTabIndex: 0,
  tabs,
  files: [],
  activeFileTab: null,
  agentBoardOpen: false,
  agentBoardSurfaceActive: false,
});

beforeEach(() => {
  fake.state = "ready";
  fake.data = new Map();
  fake.load.mockReset();
  fake.load.mockImplementation(async () => ({
    loadState: { state: fake.state, fresh: false },
    get: async (key: string) => fake.data.get(key),
    set: async (key: string, value: unknown) => {
      if (fake.state === "unreadable") throw new Error("write blocked");
      fake.data.set(key, value);
    },
    save: async () => {},
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetRememberedPanes();
  vi.restoreAllMocks();
});

describe("seedRememberedPanes", () => {
  it("folds the previous main record in and says the record may now be replaced", async () => {
    const records = new Map([["main", record([tab([pane()])])]]);

    const seeded = await seedRememberedPanes({
      enabled: true,
      mainLabel: "main",
      readRecords: async () => records,
    });

    expect(seeded).toBe(true);
    expect(rememberedPanes.value.map((entry) => entry.id)).toEqual(["claude:/w/a"]);
    expect((fake.data.get("remembered") as unknown[]).length).toBe(1);
  });

  it("takes only the main window's record", async () => {
    const records = new Map([
      ["secondary", record([tab([pane({ agent: "codex" })])])],
      ["main", record([tab([pane()])])],
    ]);

    await seedRememberedPanes({
      enabled: true,
      mainLabel: "main",
      readRecords: async () => records,
    });

    expect(rememberedPanes.value.map((entry) => entry.agent)).toEqual(["claude"]);
  });

  it("does not load or write the store with the switch off", async () => {
    const readRecords = vi.fn(async () => new Map([["main", record([tab([pane()])])]]));

    const seeded = await seedRememberedPanes({ enabled: false, mainLabel: "main", readRecords });

    expect(seeded).toBe(false);
    expect(fake.load).not.toHaveBeenCalled();
    expect(readRecords).not.toHaveBeenCalled();
    expect(fake.data.size).toBe(0);
    expect(rememberedPanes.value).toEqual([]);
  });

  it("keeps the record held when it cannot be read", async () => {
    const seeded = await seedRememberedPanes({
      enabled: true,
      mainLabel: "main",
      readRecords: async () => {
        throw new Error("boom");
      },
    });

    expect(seeded).toBe(false);
    expect(fake.data.size).toBe(0);
  });

  it("keeps the record held, and writes nothing, when the store is unreadable", async () => {
    fake.state = "unreadable";

    const seeded = await seedRememberedPanes({
      enabled: true,
      mainLabel: "main",
      readRecords: async () => new Map([["main", record([tab([pane()])])]]),
    });

    expect(seeded).toBe(false);
    expect(fake.data.size).toBe(0);
    expect(rememberedPanes.value).toEqual([]);
  });

  it("does not bring a forgotten row back on the next boot", async () => {
    // The disk: one main record, replaced by the journal only when boot says it may be.
    const records = new Map([["main", record([tab([pane()])])]]);
    const boot = async () => {
      const seeded = await seedRememberedPanes({
        enabled: true,
        mainLabel: "main",
        readRecords: async () => records,
      });
      if (!shouldHoldRecord(records.has("main"), seeded)) {
        records.delete("main");
      }
      return seeded;
    };

    expect(await boot()).toBe(true);
    expect(rememberedPanes.value.map((entry) => entry.id)).toEqual(["claude:/w/a"]);
    await forget("claude:/w/a");
    expect(rememberedPanes.value).toEqual([]);

    expect(await boot()).toBe(true);

    expect(rememberedPanes.value).toEqual([]);
    expect(fake.data.get("remembered")).toEqual([]);
  });

  it("holds the record across boots while the store is write-locked, then seeds it once readable", async () => {
    const records = new Map([["main", record([tab([pane()])])]]);
    const boot = async () => {
      const seeded = await seedRememberedPanes({
        enabled: true,
        mainLabel: "main",
        readRecords: async () => records,
      });
      if (!shouldHoldRecord(records.has("main"), seeded)) {
        records.delete("main");
      }
      return seeded;
    };

    fake.state = "unreadable";
    expect(await boot()).toBe(false);
    expect(records.has("main")).toBe(true);
    expect(fake.data.size).toBe(0);

    fake.state = "ready";
    expect(await boot()).toBe(true);
    expect(rememberedPanes.value.map((entry) => entry.id)).toEqual(["claude:/w/a"]);
    expect(records.has("main")).toBe(false);
  });
});

describe("shouldHoldRecord", () => {
  it.each([
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ])("last session %s, seeded %s -> hold %s", (hasLastSession, seeded, hold) => {
    expect(shouldHoldRecord(hasLastSession, seeded)).toBe(hold);
  });
});
