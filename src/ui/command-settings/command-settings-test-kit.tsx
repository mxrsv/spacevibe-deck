import { act } from "preact/test-utils";
import { vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings, settingsLoadState } from "../../settings/settings-store";
import { click, mount, settle } from "../controls/preset-test-kit";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { activeUpdateController } from "../../updater/active-update-controller";
import { settingsTarget } from "../settings/settings-focus-store";
import { CommandSettings } from "./command-settings";
import { commandActiveKey, commandQuery, commandScope } from "./command-settings-state";

/*
 * What every Command Settings suite repeats. The `vi.mock` calls that stub the host-backed stores
 * stay in each test file: Vitest hoists them per file.
 */

/** Elements `scrollIntoView` was called on; jsdom has no layout, so it has no such method. */
export const scrolled: Element[] = [];

export function resetCommandSettings(): void {
  settings.value = DEFAULT_SETTINGS;
  settingsLoadState.value = { status: "ready" };
  commandQuery.value = "";
  commandScope.value = null;
  commandActiveKey.value = null;
  settingsTarget.value = null;
  // What Needs attention reads: left over, it would put rows on another suite's home list.
  activeUpdateController.value = null;
  detectedAgents.value = [];
  agentsProbed.value = false;
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn<(this: Element) => void>(function (this: Element) {
    scrolled.push(this);
  });
}

export const search = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(
    'input[aria-label="Search settings"]',
  ) as HTMLInputElement;

export async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

export async function openSurface(onClose = vi.fn<() => void>()) {
  const view = await mount(<CommandSettings open onClose={onClose} />);
  return { view, onClose };
}

/** A row, live or stand-in, by its list key (`setting:scrollback`). */
export const rowOf = (key: string): HTMLElement | null =>
  document.getElementById(`command-row-${key}`);

/** The label of every row in the list, in order. */
export const rowLabels = (): string[] =>
  [...document.querySelectorAll('[aria-label="Results"] [id^="command-row-"]')].map(
    (row) => row.querySelector(".truncate")?.textContent ?? "",
  );

export const activeRow = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[aria-label="Results"] [aria-current]');

/** The scope chip of an area, not a segment of some row's choice. */
export const chip = (label: string): HTMLElement =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[aria-label="Areas"] [data-slot="toggle-group-item"]',
    ),
  ].find((item) => item.textContent === label) as HTMLElement;

/** The scope badge in the search row. */
export const badge = (): string | undefined =>
  document.querySelector('[data-slot="badge"]')?.textContent ?? undefined;

/** The control of a live row: switch, menu trigger, first segment or field. */
export const controlOf = (key: string, selector: string): HTMLElement =>
  rowOf(key)?.querySelector(selector) as HTMLElement;

export async function clickIn(element: Element | null | undefined): Promise<void> {
  await click(element as HTMLElement);
}
