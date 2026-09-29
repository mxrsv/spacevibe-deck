// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The editor pulls in the host-backed settings store; stub it so the tree
// mounts under jsdom (same shape as launch-profile-editor.test.tsx).
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));

vi.mock("../../settings/settings-store", async () => {
  const actual = await vi.importActual<typeof import("../../settings/settings-store")>(
    "../../settings/settings-store",
  );
  return { ...actual, updateSettings: vi.fn() };
});

vi.mock("../../terminal/link-client", () => ({
  defaultLinkClient: { openUrl: vi.fn(async () => {}) },
}));

// The host's answer to "do hooks work here" arrives through this facade; every
// case below chooses it.
vi.mock("../../host/agent-signals-host", async () => {
  const actual = await vi.importActual<typeof import("../../host/agent-signals-host")>(
    "../../host/agent-signals-host",
  );
  return { ...actual, agentSignalConfig: vi.fn(async () => actual.NO_SIGNAL_CONFIG) };
});

import { LaunchProfileEditor } from "./launch-profile-editor";
import { agentSignalConfig, NO_SIGNAL_CONFIG } from "../../host/agent-signals-host";
import { resetAgentHooksSupportForTests } from "../../settings/agent-hooks-support-store";
import { detectedAgents } from "../../terminal/agent-detection-store";
import { settings, updateSettings } from "../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";

/**
 * The Signals switch answers to what the HOST can do, not to the platform:
 * Windows ships no hook script (`electron/agent-hooks/hooks-supported.ts`), so
 * there Claude's and Codex's switches are unavailable (DL-23.6) and say why in
 * a tooltip. opencode's adapter is a pinned server port, not a hook, so the
 * host's answer does not speak for it. Where the host supports hooks — macOS —
 * the switch is byte-for-byte what it was before this capability existed.
 */
describe("LaunchProfileEditor Signals switch", () => {
  const UNAVAILABLE = "Not available on Windows";
  const AGENTS = ["claude", "codex", "opencode"] as const;
  const LABELS = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" } as const;
  let host: HTMLDivElement;

  beforeEach(() => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      agentSignalAdapters: { claude: true, codex: true, opencode: true },
    };
    detectedAgents.value = AGENTS.map((name) => ({ name, path: `/bin/${name}` }));
    vi.mocked(updateSettings).mockReset();
    vi.mocked(updateSettings).mockImplementation((patch) => {
      settings.value = { ...settings.value, ...patch };
    });
    vi.mocked(agentSignalConfig).mockClear();
    vi.mocked(agentSignalConfig).mockResolvedValue(NO_SIGNAL_CONFIG);
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    settings.value = DEFAULT_SETTINGS;
    detectedAgents.value = [];
    resetAgentHooksSupportForTests();
  });

  const hostSays = (hooksSupported: boolean): void => {
    vi.mocked(agentSignalConfig).mockResolvedValue({ ...NO_SIGNAL_CONFIG, hooksSupported });
  };

  /** Mount, then let the host's answer land and the tree re-render. */
  const mountSettled = async (): Promise<void> => {
    await act(async () => {
      render(<LaunchProfileEditor />, host);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const unmount = (): void => {
    act(() => {
      render(null, host);
    });
  };

  const toggle = (id: (typeof AGENTS)[number]): HTMLElement => {
    const found = host.querySelector<HTMLElement>(`[aria-label="${LABELS[id]} signals"]`);
    expect(found).not.toBeNull();
    return found!;
  };

  const press = (element: HTMLElement): void => {
    act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  describe("where the host supports hooks (macOS, Linux)", () => {
    it.each(AGENTS)("renders %s's switch live, exactly as before", async (id) => {
      hostSays(true);
      await mountSettled();

      const control = toggle(id);
      expect(control.className).toBe("cfg-btn lp-signals cfg-btn--on");
      expect(control.getAttribute("aria-checked")).toBe("true");
      expect(control.textContent).toBe("on");
      expect(control.hasAttribute("aria-disabled")).toBe(false);
      expect(control.hasAttribute("disabled")).toBe(false);
      expect(control.hasAttribute("title")).toBe(false);
    });

    it("renders an off switch as off, without a disabled treatment", async () => {
      settings.value = {
        ...DEFAULT_SETTINGS,
        agentSignalAdapters: { claude: false, codex: false, opencode: false },
      };
      hostSays(true);
      await mountSettled();

      expect(toggle("claude").className).toBe("cfg-btn lp-signals cfg-btn--off");
      expect(toggle("claude").hasAttribute("aria-disabled")).toBe(false);
    });

    it("still flips the stored setting when pressed", async () => {
      hostSays(true);
      await mountSettled();

      press(toggle("claude"));

      expect(settings.value.agentSignalAdapters.claude).toBe(false);
      expect(updateSettings).toHaveBeenCalledTimes(1);
    });

    it("stays live when the host never reports support (older host, Tauri, failed call)", async () => {
      // The default answer: `NO_SIGNAL_CONFIG`, i.e. no field at all.
      await mountSettled();

      for (const id of AGENTS) {
        expect(toggle(id).className).toBe("cfg-btn lp-signals cfg-btn--on");
        expect(toggle(id).hasAttribute("aria-disabled")).toBe(false);
        expect(toggle(id).hasAttribute("title")).toBe(false);
      }
    });
  });

  describe("where the host ships no hooks (Windows)", () => {
    it.each(["claude", "codex"] as const)(
      "makes %s's switch unavailable with a reason",
      async (id) => {
        hostSays(false);
        await mountSettled();

        const control = toggle(id);
        expect(control.getAttribute("aria-disabled")).toBe("true");
        expect(control.getAttribute("title")).toBe(UNAVAILABLE);
        expect(control.classList.contains("cfg-btn--disabled")).toBe(true);
        // DL-23.6: it keeps its tab stop, or the reason is unreachable by keyboard.
        expect(control.hasAttribute("disabled")).toBe(false);
        expect(control.tabIndex).toBeGreaterThanOrEqual(0);
      },
    );

    it("reads off while unavailable, even over a stored on", async () => {
      // Nothing registers a hook here, so "on" would claim a state that does not exist.
      hostSays(false);
      await mountSettled();

      const control = toggle("claude");
      expect(control.getAttribute("aria-checked")).toBe("false");
      expect(control.textContent).toBe("off");
      expect(control.classList.contains("cfg-btn--on")).toBe(false);
      expect(settings.value.agentSignalAdapters.claude).toBe(true);
    });

    it.each(["claude", "codex"] as const)("ignores a press on %s's switch", async (id) => {
      hostSays(false);
      await mountSettled();

      press(toggle(id));

      expect(updateSettings).not.toHaveBeenCalled();
      expect(settings.value.agentSignalAdapters[id]).toBe(true);
    });

    it("leaves opencode's switch live: its adapter is a server port, not a hook", async () => {
      hostSays(false);
      await mountSettled();

      const control = toggle("opencode");
      expect(control.className).toBe("cfg-btn lp-signals cfg-btn--on");
      expect(control.hasAttribute("aria-disabled")).toBe(false);
      expect(control.hasAttribute("title")).toBe(false);
      press(control);
      expect(settings.value.agentSignalAdapters.opencode).toBe(false);
    });

    it("keeps the Signals row in place with its label and description", async () => {
      hostSays(false);
      await mountSettled();

      const row = toggle("claude").closest(".cfg-row");
      expect(row?.querySelector(".cfg-row__label")?.textContent).toBe("Signals");
      expect(row?.querySelector(".cfg-row__desc")?.textContent).toContain("Deck hooks");
      expect(row?.querySelector(".cfg-row__value")?.contains(toggle("claude"))).toBe(true);
    });
  });

  describe("asking the host", () => {
    it("asks once for the whole editor, not once per agent row", async () => {
      hostSays(false);
      await mountSettled();

      expect(host.querySelectorAll(".lp-agent")).toHaveLength(5);
      expect(agentSignalConfig).toHaveBeenCalledTimes(1);
    });

    it("keeps a real answer for the window: a second Settings mount does not ask again", async () => {
      hostSays(false);
      await mountSettled();
      unmount();
      await mountSettled();

      expect(agentSignalConfig).toHaveBeenCalledTimes(1);
      // The kept answer still shapes the second mount.
      expect(toggle("claude").getAttribute("aria-disabled")).toBe("true");
    });

    it("asks again on the next mount when the host gave no answer", async () => {
      await mountSettled();
      unmount();
      await mountSettled();

      expect(agentSignalConfig).toHaveBeenCalledTimes(2);
    });
  });
});
