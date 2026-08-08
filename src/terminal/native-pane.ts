import { SearchAddon } from "@xterm/addon-search";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Settings } from "../settings/settings-schema";
import type { PaneHeaderInfo } from "../lib/process-info";
import type { Pane, PaneEvents } from "./pane";
import type { NativePaneClient } from "./native-pane-client";
import { applyPaneBackground } from "./pane-background";
import { nativeTerminalAppearance } from "./native-appearance";

export function createNativePane(
  id: number,
  initial: Settings,
  events: PaneEvents,
  client: NativePaneClient,
): Pane {
  const element = document.createElement("div");
  element.className = "pane pane--native";
  applyPaneBackground(element, initial, "alacritty");

  const bar = document.createElement("div");
  bar.className = "pane__bar";
  const dot = document.createElement("span");
  dot.className = "pane__dot";
  const cwdEl = document.createElement("span");
  cwdEl.className = "pane__cwd";
  const badge = document.createElement("span");
  badge.className = "pane__badge pane__badge--agent";
  badge.textContent = "alacritty";
  bar.append(dot, cwdEl, badge);

  const anchor = document.createElement("div");
  anchor.className = "pane__anchor";
  const anchorGrip = document.createElement("span");
  anchorGrip.className = "pane__anchor-grip";
  anchorGrip.textContent = "⋮⋮";
  const anchorCwd = document.createElement("span");
  anchorCwd.className = "pane__anchor-cwd";
  anchor.append(anchorGrip, anchorCwd);

  const host = document.createElement("div");
  host.className = "pane__term pane__term--native";
  host.tabIndex = 0;
  host.setAttribute("aria-label", "Embedded Alacritty terminal");
  const errorBanner = document.createElement("div");
  errorBanner.className = "pane__native-error";
  errorBanner.setAttribute("role", "alert");
  errorBanner.hidden = true;
  const errorText = document.createElement("span");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "retry";
  retry.setAttribute("aria-label", "Retry embedded Alacritty pane");
  errorBanner.append(errorText, retry);
  element.append(bar, anchor, host, errorBanner);

  let mounted = false;
  let disposed = false;
  let visible = false;
  let warned = false;
  let active = false;
  let animationFrame: number | null = null;
  let lastUpdate = "";
  let lastSettings = initial;

  function showError(error: unknown): void {
    errorText.textContent =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Alacritty is unavailable";
    errorBanner.hidden = false;
  }

  function clearError(): void {
    errorBanner.hidden = true;
    errorText.textContent = "";
  }

  function bounds() {
    const rect = host.getBoundingClientRect();
    const inset = active ? 1 : 0;
    const dragInset = element.closest(".pane-bar-hidden") ? 26 : 0;
    return {
      left: rect.left + inset,
      top: rect.top + inset + dragInset,
      width: Math.max(0, rect.width - inset * 2),
      height: Math.max(0, rect.height - inset * 2 - dragInset),
    };
  }

  function syncNow(): void {
    animationFrame = null;
    if (disposed || !mounted) {
      return;
    }
    const rect = bounds();
    const shown =
      visible && element.isConnected && rect.width >= 1 && rect.height >= 1;
    const signature = JSON.stringify([rect, shown]);
    if (signature === lastUpdate) return;
    lastUpdate = signature;
    void client.updateAlacritty(id, rect, shown).catch((error: unknown) => {
      showError(error);
      if (!warned) {
        warned = true;
        console.warn("Embedded Alacritty update failed:", error);
      }
    });
  }

  function sync(): void {
    if (disposed || animationFrame !== null) return;
    animationFrame = requestAnimationFrame(syncNow);
  }

  function forceSync(): void {
    lastUpdate = "";
    sync();
  }

  const windowUnlisteners: Array<() => void> = [];
  if ("__TAURI_INTERNALS__" in globalThis) {
    const appWindow = getCurrentWindow();
    void Promise.all([
      appWindow.onMoved(forceSync),
      appWindow.onResized(forceSync),
      appWindow.onScaleChanged(forceSync),
    ])
      .then((unlisteners) => {
        if (disposed) {
          unlisteners.forEach((unlisten) => unlisten());
        } else {
          windowUnlisteners.push(...unlisteners);
        }
      })
      .catch((error: unknown) => {
        console.warn("Native terminal window tracking is unavailable:", error);
      });
  }

  const observer = new ResizeObserver(sync);
  element.addEventListener("focusin", () => events.onFocus(id));
  element.addEventListener("mousedown", () => events.onFocus(id));

  const ANCHOR_ZONE_PX = 26;
  element.addEventListener("mousemove", (event) => {
    const top = element.getBoundingClientRect().top;
    element.classList.toggle(
      "is-anchor-zone",
      event.clientY - top < ANCHOR_ZONE_PX,
    );
  });
  element.addEventListener("mouseleave", () => {
    element.classList.remove("is-anchor-zone");
  });

  const pane: Pane = {
    id,
    kind: "alacritty",
    element,
    // Native Alacritty owns its own scrollback and search UI. TerminalManager
    // checks `kind` before invoking the xterm search helpers.
    search: new SearchAddon(),
    mount() {
      if (!mounted) {
        observer.observe(host);
        mounted = true;
      }
      sync();
    },
    write() {},
    writeln() {},
    fit: sync,
    clear() {
      void client.performAlacrittyAction(id, "clear");
    },
    copySelection() {
      void client.performAlacrittyAction(id, "copy");
    },
    paste() {
      void client.performAlacrittyAction(id, "paste");
    },
    scrollPage(dir) {
      void client.performAlacrittyAction(id, dir < 0 ? "page-up" : "page-down");
    },
    scrollToEdge(edge) {
      void client.performAlacrittyAction(
        id,
        edge === "top" ? "scroll-top" : "scroll-bottom",
      );
    },
    openSearch() {
      void client.performAlacrittyAction(id, "search");
    },
    findNext() {
      void client.performAlacrittyAction(id, "search-next");
    },
    findPrevious() {
      void client.performAlacrittyAction(id, "search-previous");
    },
    focus() {
      events.onFocus(id);
      void client.focusAlacritty(id).catch((error: unknown) => {
        console.warn("Embedded Alacritty focus failed:", error);
      });
    },
    setVisible(next) {
      visible = next;
      if (!next) lastUpdate = "";
      sync();
    },
    setActive(next) {
      active = next;
      lastUpdate = "";
      sync();
    },
    applySettings(next) {
      lastSettings = next;
      applyPaneBackground(element, next, "alacritty");
      void client
        .applyAlacrittyAppearance(id, nativeTerminalAppearance(next))
        .then(clearError)
        .catch((error: unknown) => {
          showError(error);
          console.warn("Embedded Alacritty appearance update failed:", error);
        });
      sync();
    },
    setHeaderInfo(info: PaneHeaderInfo) {
      dot.style.background = info.dotColor;
      cwdEl.textContent = info.cwd;
      anchorCwd.textContent = info.cwd;
    },
    captureSelection() {
      return null;
    },
    restoreSelection() {},
    dispose() {
      disposed = true;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      windowUnlisteners.forEach((unlisten) => unlisten());
      observer.disconnect();
      element.remove();
    },
  };

  retry.addEventListener("click", () => {
    clearError();
    lastUpdate = "";
    void client
      .applyAlacrittyAppearance(id, nativeTerminalAppearance(lastSettings))
      .then(sync)
      .catch(showError);
  });

  return pane;
}
