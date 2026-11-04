// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../../host/shell-host", () => ({ writeText: vi.fn(async () => {}) }));

import { resetFileSurfaces } from "../../files/file-surface-store";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { click, mount, settle } from "../controls/preset-test-kit";
import { dockStageWidth, AGENT_DOCK_WIDE } from "./agent-dock-layout";
import { resetAgentDockState } from "./agent-dock-state";
import { testFileBodies } from "./dock-files-test-kit";
import { DockTabStrip } from "./dock-tab-strip";

const ROOT = "/r/main";

function resizeTo(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

const button = (label: string): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
const tabList = (): HTMLElement =>
  document.body.querySelector<HTMLElement>('[role="tablist"]') as HTMLElement;

/** jsdom lays nothing out: give the tab region measurable, scrollable metrics. */
function stubScrollMetrics(
  list: HTMLElement,
  metrics: { scrollWidth: number; clientWidth: number },
) {
  let scrollLeft = 0;
  Object.defineProperty(list, "scrollWidth", {
    configurable: true,
    get: () => metrics.scrollWidth,
  });
  Object.defineProperty(list, "clientWidth", {
    configurable: true,
    get: () => metrics.clientWidth,
  });
  Object.defineProperty(list, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
}

async function mountStrip() {
  const files = testFileBodies();
  const view = await mount(
    <DockTabStrip
      views={["changes"]}
      view="changes"
      surface="view"
      root={ROOT}
      controller={files.controller}
      closeLabel="Hide the side panel"
      closeChord={null}
      onClose={() => {}}
    />,
  );
  return { view, files };
}

beforeEach(() => {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment: true });
  resizeTo(1600);
  settings.value = DEFAULT_SETTINGS;
  resetAgentDockState();
  resetFileSurfaces();
});

afterEach(() => {
  resizeTo(1024);
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
  resetAgentDockState();
  resetFileSurfaces();
});

describe("the strip's tab scroll arrows", () => {
  it("appear only when the tabs overflow, and each press moves the tabs", async () => {
    const { view, files } = await mountStrip();
    const metrics = { scrollWidth: 200, clientWidth: 200 };
    stubScrollMetrics(tabList(), metrics);
    await act(async () => {
      await files.controller.openFile(ROOT, `${ROOT}/a.ts`, true);
      await files.controller.openFile(ROOT, `${ROOT}/b.ts`, true);
    });
    await settle();
    expect(button("Scroll tabs left")).toBeNull();
    expect(button("Scroll tabs right")).toBeNull();

    metrics.scrollWidth = 600;
    await act(async () => {
      tabList().dispatchEvent(new Event("scroll"));
    });
    await settle();
    expect(button("Scroll tabs left")?.disabled).toBe(true);
    expect(button("Scroll tabs right")?.disabled).toBe(false);

    await click(button("Scroll tabs right") as HTMLElement);
    expect(tabList().scrollLeft).toBeGreaterThan(0);
    expect(button("Scroll tabs left")?.disabled).toBe(false);

    await click(button("Scroll tabs left") as HTMLElement);
    expect(tabList().scrollLeft).toBe(0);

    metrics.scrollWidth = 200;
    await act(async () => {
      tabList().dispatchEvent(new Event("scroll"));
    });
    await settle();
    expect(button("Scroll tabs right")).toBeNull();
    await view.unmount();
  });
});

describe("a file opened while a view holds the body", () => {
  /** Lay the file tabs out 100px wide, at the offset `left` names for each path. */
  function stubTabOffsets(left: Readonly<Record<string, number>>): () => void {
    const proto = HTMLElement.prototype;
    const saved = ["offsetLeft", "offsetWidth"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const,
    );
    Object.defineProperty(proto, "offsetLeft", {
      configurable: true,
      get(this: HTMLElement) {
        return left[this.dataset.path ?? ""] ?? 0;
      },
    });
    Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
    return () => {
      for (const [key, descriptor] of saved) {
        if (descriptor !== undefined) {
          Object.defineProperty(proto, key, descriptor);
        }
      }
    };
  }

  it("brings that file's tab into the strip once per open, not on every render", async () => {
    const restore = stubTabOffsets({ [`${ROOT}/a.ts`]: 0, [`${ROOT}/c.ts`]: 400 });
    const { view, files } = await mountStrip();
    stubScrollMetrics(tabList(), { scrollWidth: 600, clientWidth: 200 });
    await act(async () => {
      await files.controller.openFileInBackground(ROOT, `${ROOT}/a.ts`, true);
      await files.controller.openFileInBackground(ROOT, `${ROOT}/c.ts`, false);
    });
    await settle();
    expect(tabList().scrollLeft).toBe(300);

    tabList().scrollLeft = 0;
    await view.update(
      <DockTabStrip
        views={["changes"]}
        view="changes"
        surface="view"
        root={ROOT}
        controller={files.controller}
        closeLabel="Hide the side panel"
        closeChord="⌘B"
        onClose={() => {}}
      />,
    );
    await settle();
    expect(tabList().scrollLeft).toBe(0);
    restore();
    await view.unmount();
  });
});

describe("the strip's maximize control", () => {
  const painted = (): number => dockStageWidth(settings.value.dockWidth, null);

  it("widens the dock without touching the stored width, and restores on the second press", async () => {
    const view = (await mountStrip()).view;
    const stored = settings.value.dockWidth;
    const before = painted();
    expect(before).not.toBe(AGENT_DOCK_WIDE);

    await click(button("Widen the panel") as HTMLElement);
    expect(painted()).toBe(AGENT_DOCK_WIDE);
    expect(button("Restore the panel width")?.getAttribute("aria-pressed")).toBe("true");

    await click(button("Restore the panel width") as HTMLElement);
    expect(painted()).toBe(before);
    expect(settings.value.dockWidth).toBe(stored);
    await view.unmount();
  });

  it("is disabled when the window cannot spare the width", async () => {
    resizeTo(1440);
    const view = (await mountStrip()).view;
    expect(button("Widen the panel")?.disabled).toBe(true);
    await view.unmount();
  });
});
