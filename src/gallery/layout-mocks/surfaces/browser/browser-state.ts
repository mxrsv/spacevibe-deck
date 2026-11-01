import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { DEV_SERVERS, type InspectMode, type PickedElement } from "./browser-data";

const SAMPLE_PICK: PickedElement = {
  selector: 'tr.model-row[data-model="gem-pro"]',
  summary: "Gemini 2.5 Pro row, score 90",
};
/** Stock select popup: one 28px row per server, plus its 4px padding and ring. */
const MENU_HEIGHT = DEV_SERVERS.length * 28 + 10;
const MENU_OFFSET = 4;
/** The gutter around the view rectangle. */
const GUTTER = 8;

/**
 * Browser state for one mock, plus the one rule every placement here follows: a menu never
 * draws over the native view, so while the dev-server menu is open the view yields by that
 * much height.
 */
export function useBrowser(initial: InspectMode) {
  const port = useSignal(DEV_SERVERS[0].port);
  const inspect = useSignal<InspectMode>(initial);
  const picked = useSignal<PickedElement | null>(initial === "picked" ? SAMPLE_PICK : null);
  const menuYield = useSignal(0);
  const area = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && inspect.value === "pick") inspect.value = "off";
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspect]);

  return {
    port,
    inspect,
    picked,
    menuYield,
    area,
    trigger,
    server: DEV_SERVERS.find((item) => item.port === port.value) ?? DEV_SERVERS[0],
    toggleInspect() {
      inspect.value = inspect.value === "pick" ? "off" : "pick";
      if (inspect.value === "pick") picked.value = null;
    },
    pick(element: PickedElement) {
      picked.value = element;
      inspect.value = "picked";
    },
    clearPick() {
      picked.value = null;
      inspect.value = "off";
    },
    /** Called when the dev-server menu opens or closes. */
    setMenu(open: boolean) {
      const top = area.current?.getBoundingClientRect().top;
      const bottom = trigger.current?.getBoundingClientRect().bottom;
      if (!open || top === undefined || bottom === undefined) {
        menuYield.value = 0;
        return;
      }
      menuYield.value = Math.max(0, Math.ceil(bottom + MENU_OFFSET + MENU_HEIGHT - top - GUTTER));
    },
  };
}

export type Browser = ReturnType<typeof useBrowser>;
