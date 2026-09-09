import { stripPreferences } from "../lib/strip-order";
import { tabViews } from "../terminal/tabs-store";
import { fileTabsFor } from "../files/file-surface-store";
import { stageSurfaceDescriptors } from "./stage-surface-strip";
import type { TabStripProps } from "./tab-strip";
import type { StripMenuAction } from "./tab-strip-menu";

export interface TabCloseTarget {
  readonly key: string;
  readonly openedAt: number;
  readonly kind: "terminal" | "file" | "browser" | "agent-board";
  readonly terminalKey?: number;
  readonly workspace?: string;
  readonly path?: string;
  readonly close: () => void | Promise<void>;
}

// Guards intentionally run sequentially: cancellation stops later closes.
/* oxlint-disable no-await-in-loop */
export function closeTargets(
  chips: readonly TabCloseTarget[],
  key: string,
  action: StripMenuAction,
): readonly TabCloseTarget[] {
  const index = chips.findIndex((chip) => chip.key === key);
  if (index < 0) return [];
  if (action === "close") return [chips[index]!];
  return chips.filter(
    (chip, position) =>
      chip.key !== key &&
      !stripPreferences.value.pinned.includes(chip.openedAt) &&
      (action !== "right" || position > index),
  );
}

/** A cancelled file guard stops the remaining batch. Terminal targets use
 * the existing single Busy prompt. Earlier confirmed file closes stay closed. */
export async function closeChips(
  targets: readonly TabCloseTarget[],
  props: Pick<TabStripProps, "onCloseTabs" | "fileController">,
  bulk: boolean,
): Promise<void> {
  for (const chip of targets.filter((item) => item.kind === "file")) {
    if (!fileTabsFor(chip.workspace ?? null).some((item) => item.openedAt === chip.openedAt))
      continue;
    await chip.close();
    if (fileTabsFor(chip.workspace ?? null).some((item) => item.openedAt === chip.openedAt)) return;
  }
  const terminals = targets.filter((chip) => chip.kind === "terminal");
  if (bulk && props.onCloseTabs) {
    const indexes = terminals
      .map((chip) => tabViews.value.findIndex((tab) => tab.key === chip.terminalKey))
      .filter((index) => index >= 0);
    if (indexes.length > 0 && !(await props.onCloseTabs(indexes))) return;
  } else {
    for (const chip of terminals) {
      await chip.close();
      if (tabViews.value.some((tab) => tab.key === chip.terminalKey)) return;
    }
  }
  for (const chip of targets.filter(
    (item) => item.kind === "browser" || item.kind === "agent-board",
  )) {
    if (
      stageSurfaceDescriptors(props.fileController).some(
        (item) => item.kind === chip.kind && item.openedAt === chip.openedAt,
      )
    )
      await chip.close();
  }
}
