// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DevServerCapability,
  DevServerResolveResult,
  DevServerRow,
} from "../../dev-servers/dev-server-types";
import { railCardMenuOpen } from "../../chrome/events";
import type { DevServerActionDeps } from "./dev-server-actions";
import { NOW, deckScans, row, snapshot } from "./dev-server-fixtures";
import { subjectFor } from "./dev-server-scope";
import { DevServersChip, type DevServersChipProps } from "./dev-servers-chip";

const AVAILABLE: DevServerCapability = { available: true };
const scans = deckScans();

function deps(over: Partial<DevServerActionDeps> = {}): DevServerActionDeps {
  return {
    resolve: vi.fn(async (): Promise<DevServerResolveResult> => ({
      status: "ready",
      id: "a",
      url: "http://127.0.0.1:5173/",
      protocol: "http",
    })),
    openInDeck: vi.fn(async (url: string) => ({ ok: true as const, url })),
    openExternal: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    ...over,
  };
}

describe("DevServersChip", () => {
  let host: HTMLDivElement;
  let onRetry: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    host = document.createElement("div");
    document.body.appendChild(host);
    onRetry = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    act(() => render(null, host));
    host.remove();
  });

  const mount = (over: Partial<DevServersChipProps> & { rows?: readonly DevServerRow[] } = {}) => {
    const { rows = [], ...rest } = over;
    const props: DevServersChipProps = {
      capability: AVAILABLE,
      snapshot: snapshot(rows),
      failed: false,
      subject: subjectFor("/w/deck", scans),
      scans,
      deps: deps(),
      onRetry,
      ...rest,
    };
    act(() => render(<DevServersChip {...props} />, host));
    return props;
  };
  const chip = (): HTMLButtonElement => host.querySelector(".dsv-chip") as HTMLButtonElement;
  const dialog = (): HTMLElement | null => document.querySelector('[role="dialog"]');
  const open = (): void => {
    act(() => chip().click());
  };
  const cells = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-col]"));
  const status = (): string => document.querySelector(".dsv-status")?.textContent ?? "";
  const press = (target: EventTarget, key: string): void => {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  };
  const flush = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  describe("the chip", () => {
    it.each([
      ["before the host has answered", null],
      ["on a host with no bridge", { available: false, reason: "unsupported-host" } as const],
      [
        "on a platform that cannot be scanned",
        { available: false, reason: "unsupported-platform", platform: "win32" } as const,
      ],
    ])("is absent %s", (_name, capability) => {
      mount({ capability });
      expect(host.innerHTML).toBe("");
    });

    it("stays at zero with no dot, and names itself for a screen reader", () => {
      mount();

      expect(chip().textContent).toBe("0");
      expect(chip().getAttribute("aria-label")).toBe("Dev servers — 0 running");
      expect(chip().getAttribute("aria-haspopup")).toBe("dialog");
      expect(chip().getAttribute("aria-expanded")).toBe("false");
      expect(host.querySelector(".dsv-chip__dot")).toBeNull();
    });

    it("counts only running servers in the active checkout, with a live green dot", () => {
      mount({
        rows: [
          row(),
          row({ id: "b", port: 3000 }),
          row({ id: "u", port: 3001, liveness: "unknown" }),
          row({ id: "s", port: 3002, liveness: "stopped", stoppedAt: NOW }),
          row({ id: "o", port: 3003, displayRoot: "/w/deck-redesign" }),
        ],
      });

      expect(chip().textContent).toBe("2");
      expect(host.querySelector(".dsv-chip__dot")?.getAttribute("data-tone")).toBe("running");
    });

    it("turns the dot red and still when the scan failed, and says so", () => {
      mount({ rows: [row()], failed: true });

      expect(host.querySelector(".dsv-chip__dot")?.getAttribute("data-tone")).toBe("failed");
      expect(chip().getAttribute("aria-label")).toBe("Dev servers — 1 running, last scan failed");
    });

    it("keeps an unavailable icon quiet on hover, like the toolbar's", () => {
      const css = readFileSync("src/styles/05-tab-bar-toolbar.css", "utf8");
      expect(css).toMatch(
        /\.iconbtn\.is-unavailable:hover\s*{[^}]*background:\s*transparent[^}]*cursor:\s*default/,
      );
      expect(readFileSync("src/ui/dev-servers/dev-server-row.tsx", "utf8")).toContain(
        '"iconbtn dsv-icon"',
      );
    });

    it("loops only under no-preference, on transform and opacity, and only for a running dot", () => {
      const css = readFileSync("src/styles/24-dev-servers.css", "utf8");
      // A media block closes on a line of its own; the rules inside it are indented.
      const outsideMotion = css.replace(
        /@media \(prefers-reduced-motion: no-preference\)\s*{[\s\S]*?\n}\n/g,
        "",
      );
      expect(outsideMotion).not.toMatch(/animation\s*:/);
      expect(css).toMatch(
        /@media \(prefers-reduced-motion: no-preference\)\s*{\s*\.dsv-chip__dot\[data-tone="running"\]::after\s*{[^}]*animation:\s*dsv-live 1\.8s ease-out infinite/,
      );
      const frames = css.match(/@keyframes dsv-live\s*{([\s\S]*?)\n}\n/)?.[1] ?? "";
      const animated = new Set([...frames.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1]));
      expect(animated).toEqual(new Set(["opacity", "transform"]));
    });
  });

  describe("the popover", () => {
    it("opens as a labelled dialog on the first action and hides the native view", () => {
      railCardMenuOpen.value = false;
      mount({ rows: [row()] });

      open();

      expect(dialog()?.getAttribute("aria-label")).toBe("Dev servers");
      expect(chip().getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(cells()[0]);
      expect(railCardMenuOpen.value).toBe(true);
    });

    it("lands on the scope select when nothing is listed, so the keys still reach something", () => {
      mount({ rows: [] });
      open();

      expect(document.activeElement).toBe(document.querySelector(".dsv-select select"));
    });

    it("draws a running row with its endpoint, state word, address and protocol token", () => {
      mount({ rows: [row()] });
      open();

      const li = document.querySelector(".dsv-row") as HTMLElement;
      expect(li.querySelector(".dsv-row__title")?.textContent).toBe("127.0.0.1:5173");
      expect(li.querySelector(".dsv-row__state")?.textContent).toBe("Running");
      expect(li.querySelector(".dsv-row__url")?.textContent).toBe("http://127.0.0.1:5173/");
      expect(li.querySelector(".dsv-row__meta")?.textContent).toBe("HTTP");
      expect(li.querySelector(".dsv-mark")?.getAttribute("data-state")).toBe("running");
    });

    it("never turns Running into Stopped because the protocol could not be identified", () => {
      mount({
        rows: [row({ url: null, protocol: "unknown", identificationError: "tls:DEPTH_ZERO" })],
      });
      open();

      const li = document.querySelector(".dsv-row") as HTMLElement;
      expect(li.querySelector(".dsv-row__state")?.textContent).toBe("Running");
      expect(li.querySelector(".dsv-row__meta")?.textContent).toBe("Certificate not trusted");
      expect(li.querySelector(".dsv-row__url")?.textContent).toBe("No web address");
    });

    it("gives stopped and unknown rows their age, a different mark and no running look", () => {
      mount({
        rows: [
          row({ id: "u", port: 3001, liveness: "unknown", observedAt: NOW - 120_000 }),
          row({ id: "s", port: 3002, liveness: "stopped", stoppedAt: NOW - 60_000 }),
        ],
      });
      open();

      const [unknown, stopped] = Array.from(document.querySelectorAll<HTMLElement>(".dsv-row"));
      expect(unknown.querySelector(".dsv-mark")?.getAttribute("data-state")).toBe("unknown");
      expect(unknown.querySelector(".dsv-row__meta")?.textContent).toBe(
        "HTTPlast seen 2 minutes ago",
      );
      expect(stopped.querySelector(".dsv-row__state")?.textContent).toBe("Stopped");
      expect(stopped.querySelector(".dsv-row__meta")?.textContent).toBe("stopped 1 minute ago");
    });

    it("keeps a long address whole in its title and lets CSS truncate it", () => {
      const long = `http://127.0.0.1:5173/${"deep/".repeat(40)}`;
      mount({ rows: [row({ url: long })] });
      open();

      expect(document.querySelector(".dsv-row__url")?.getAttribute("title")).toBe(long);
      expect(readFileSync("src/styles/24-dev-servers.css", "utf8")).toMatch(
        /\.dsv-row__url\s*{[^}]*text-overflow:\s*ellipsis/,
      );
    });

    it("says it is scanning before the first reading, and why a scan failed", () => {
      mount({ snapshot: null });
      open();
      expect(document.querySelector(".dsv-empty__title")?.textContent).toContain(
        "Looking for servers",
      );
      expect(status()).toBe("Scanning for listening servers…");

      mount({ snapshot: snapshot([]), failed: true });
      expect(document.querySelector(".dsv-empty__title")?.textContent).toBe(
        "Nothing to show until a scan succeeds.",
      );
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("Scan failed");
    });

    it("keeps the last readings on screen beside the failure, and retries on request", () => {
      mount({ rows: [row()], failed: true });
      open();

      expect(document.querySelectorAll(".dsv-row")).toHaveLength(1);
      act(() => (document.querySelector(".load-error__retry") as HTMLButtonElement).click());
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("says nothing was found for the scope and offers the wider one", () => {
      mount({ rows: [row({ id: "o", displayRoot: "/w/api" })] });
      open();

      expect(document.querySelector(".dsv-empty__title")?.textContent).toBe(
        "No dev servers found for this worktree.",
      );
      act(() => (document.querySelector(".dsv-link") as HTMLButtonElement).click());
      expect(document.querySelectorAll(".dsv-row")).toHaveLength(1);
    });

    it("follows the scope select, and starts on the active checkout each time it opens", () => {
      mount({ rows: [row(), row({ id: "r", displayRoot: "/w/deck-redesign", port: 3000 })] });
      open();
      const select = document.querySelector(".dsv-select select") as HTMLSelectElement;
      expect(select.value).toBe("worktree");
      expect(document.querySelectorAll(".dsv-row")).toHaveLength(1);

      act(() => {
        select.value = "project";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(document.querySelectorAll(".dsv-row")).toHaveLength(2);

      press(select, "Escape");
      open();
      expect((document.querySelector(".dsv-select select") as HTMLSelectElement).value).toBe(
        "worktree",
      );
    });
  });

  describe("the keyboard and dismissal", () => {
    const two = [row(), row({ id: "b", port: 3000 })];

    it("walks the grid with the arrows and keeps one tab stop", () => {
      mount({ rows: two });
      open();
      const [firstOpen, firstExternal, firstCopy, secondOpen] = cells();

      expect(cells().filter((cell) => cell.tabIndex === 0)).toEqual([firstOpen]);
      press(firstOpen, "ArrowRight");
      expect(document.activeElement).toBe(firstExternal);
      press(firstExternal, "ArrowRight");
      expect(document.activeElement).toBe(firstCopy);
      press(firstCopy, "ArrowRight");
      expect(document.activeElement).toBe(firstCopy);
      press(firstCopy, "ArrowDown");
      expect(document.activeElement).toBe(cells()[5]);
      press(document.activeElement as HTMLElement, "ArrowUp");
      expect(document.activeElement).toBe(firstCopy);
      expect(secondOpen.tabIndex).toBe(-1);
      expect(firstCopy.tabIndex).toBe(0);
      expect(firstOpen.tabIndex).toBe(-1);
    });

    it("closes on Escape, returns focus to the chip and keeps the key from a terminal", () => {
      mount({ rows: two });
      open();
      const reached = vi.fn();
      document.body.addEventListener("keydown", reached);

      press(cells()[0], "Escape");

      document.body.removeEventListener("keydown", reached);
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(chip());
      expect(reached).not.toHaveBeenCalled();
    });

    it("closes on a press outside, and not on one inside or on the chip's own toggle", () => {
      mount({ rows: two });
      open();

      act(() => {
        cells()[0].dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      });
      expect(dialog()).not.toBeNull();

      act(() => {
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      });
      expect(dialog()).toBeNull();
    });

    it("releases the native view shortly after it closes", () => {
      vi.useFakeTimers();
      railCardMenuOpen.value = false;
      mount({ rows: two });
      open();
      expect(railCardMenuOpen.value).toBe(true);

      press(cells()[0], "Escape");
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(railCardMenuOpen.value).toBe(false);
    });
  });

  describe("unavailable, not disabled", () => {
    it("keeps a stopped row's open actions focusable, quiet and explained", () => {
      mount({
        rows: [row({ liveness: "stopped", stoppedAt: NOW - 1000 })],
        deps: deps(),
      });
      open();
      const [openDeck, openExternal, copy] = cells();

      for (const button of [openDeck, openExternal]) {
        expect(button.disabled).toBe(false);
        expect(button.getAttribute("aria-disabled")).toBe("true");
        expect(button.classList.contains("is-unavailable")).toBe(true);
      }
      expect(copy.getAttribute("aria-disabled")).toBe("false");

      act(() => openDeck.focus());
      expect(document.querySelector('[role="tooltip"] .action-tip__reason')?.textContent).toBe(
        "Not running",
      );
      expect(openDeck.getAttribute("aria-describedby")).toBe(
        document.querySelector('[role="tooltip"]')?.id,
      );
    });

    it("does nothing when an unavailable action is pressed", async () => {
      const d = deps();
      mount({ rows: [row({ liveness: "unknown" })], deps: d });
      open();

      act(() => cells()[0].click());
      await flush();

      expect(d.resolve).not.toHaveBeenCalled();
      expect(d.openInDeck).not.toHaveBeenCalled();
    });

    it("explains an unidentified server instead of offering a URL", () => {
      mount({ rows: [row({ url: null, protocol: "unknown", identificationError: "not-http" })] });
      open();

      expect(cells()[0].getAttribute("aria-disabled")).toBe("true");
      expect(cells()[2].getAttribute("aria-label")).toBe("Copy address — 127.0.0.1:5173");
    });
  });

  describe("feedback", () => {
    it("rechecks the instance, opens in Deck and closes the popover", async () => {
      const d = deps();
      mount({ rows: [row()], deps: d });
      open();

      act(() => cells()[0].click());
      await flush();

      expect(d.resolve).toHaveBeenCalledWith("a", "token-a");
      expect(d.openInDeck).toHaveBeenCalledWith("http://127.0.0.1:5173/");
      expect(dialog()).toBeNull();
    });

    it("stays open and says why when the Deck browser would not open", async () => {
      const d = deps({
        openInDeck: vi.fn(async () => ({
          ok: false as const,
          message: "The Deck browser could not open.",
        })),
      });
      mount({ rows: [row()], deps: d });
      open();

      act(() => cells()[0].click());
      await flush();

      expect(dialog()).not.toBeNull();
      expect(status()).toBe("The Deck browser could not open.");
      expect(document.querySelector(".dsv-status")?.getAttribute("data-tone")).toBe("error");
    });

    it("refuses a stale instance visibly and acts on nothing", async () => {
      const d = deps({ resolve: vi.fn(async () => ({ status: "stale" }) as const) });
      mount({ rows: [row()], deps: d });
      open();

      act(() => cells()[1].click());
      await flush();

      expect(d.openExternal).not.toHaveBeenCalled();
      expect(status()).toBe("Not opened — 127.0.0.1:5173 is no longer the server that was listed.");
    });

    it("reports a copy and a refused clipboard", async () => {
      const d = deps();
      mount({ rows: [row()], deps: d });
      open();

      act(() => cells()[2].click());
      await flush();
      expect(d.copy).toHaveBeenCalledWith("http://127.0.0.1:5173/");
      expect(status()).toBe("Copied http://127.0.0.1:5173/");

      const denied = deps({
        copy: vi.fn(async () => {
          throw new Error("denied");
        }),
      });
      mount({ rows: [row()], deps: denied });
      act(() => cells()[2].click());
      await flush();
      expect(status()).toBe("Could not copy — the clipboard is not available.");
    });

    it("ignores a second press while an action is still being checked", async () => {
      let finish: (value: DevServerResolveResult) => void = () => {};
      const pending = new Promise<DevServerResolveResult>((resolve) => {
        finish = resolve;
      });
      const d = deps({ resolve: vi.fn(() => pending) });
      mount({ rows: [row()], deps: d });
      open();

      act(() => cells()[1].click());
      act(() => cells()[1].click());
      act(() => cells()[2].click());
      expect(d.resolve).toHaveBeenCalledTimes(1);
      expect(status()).toBe("Checking…");

      finish({ status: "ready", id: "a", url: "http://127.0.0.1:5173/", protocol: "http" });
      await flush();
      expect(d.openExternal).toHaveBeenCalledTimes(1);
      expect(status()).toBe("Opened 127.0.0.1:5173 in your browser");

      act(() => cells()[2].click());
      await flush();
      expect(d.copy).toHaveBeenCalledTimes(1);
    });

    it("lets go of the busy state when an action throws", async () => {
      const d = deps({
        openInDeck: vi.fn(async () => {
          throw new Error("boom");
        }),
      });
      mount({ rows: [row()], deps: d });
      open();

      act(() => cells()[0].click());
      await flush();
      expect(status()).toBe("Could not finish that — try again.");

      act(() => cells()[2].click());
      await flush();
      expect(d.copy).toHaveBeenCalledTimes(1);
    });

    it("drops a result that arrives after the popover closed", async () => {
      let finish: (value: DevServerResolveResult) => void = () => {};
      const first = new Promise<DevServerResolveResult>((resolve) => {
        finish = resolve;
      });
      const d = deps({ resolve: vi.fn(() => first) });
      mount({ rows: [row()], deps: d });
      open();
      act(() => cells()[0].click());
      act(() => chip().click());
      expect(dialog()).toBeNull();

      open();
      expect(status()).not.toBe("Checking…");
      finish({ status: "ready", id: "a", url: "http://127.0.0.1:5173/", protocol: "http" });
      await flush();

      // The late completion neither closes the reopened popover nor writes into it.
      expect(dialog()).not.toBeNull();
      expect(status()).not.toContain("Opened");
    });

    it("reports an external browser that would not open", async () => {
      const d = deps({
        openExternal: vi.fn(async () => {
          throw new Error("no handler");
        }),
      });
      mount({ rows: [row()], deps: d });
      open();

      act(() => cells()[1].click());
      await flush();

      expect(status()).toBe("Could not open your browser.");
    });
  });
});
