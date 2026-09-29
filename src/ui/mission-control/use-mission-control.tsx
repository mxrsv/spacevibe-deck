import { useSignalEffect } from "@preact/signals";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { PaneRect } from "../../lib/pane-geometry";
import { repositoryScans } from "../../repositories/repositories-store";
import { paneTails } from "../../terminal/session-tail-store";
import type { TabManager } from "../../terminal/tab-manager";
import { activeTabIndex, tabViews } from "../../terminal/tabs-store";
import { buildSpaces } from "../spaces/space-model";
import { currentSpaceOrder } from "../spaces/space-order";
import { createSpaceSlider, type SlideDirection } from "../spaces/space-slide";
import { useSpaceSwipe } from "../spaces/use-space-swipe";
import { MissionControl, WINDOW_ROWS, type MissionExit } from "./mission-control";
import { dismissMissionControl, missionControlOpen } from "./mission-control-store";

/**
 * `App`'s half of spaces and Mission Control (DL §35): the chord, the slide
 * behind every terminal-to-terminal switch, the swipe, and the surface. Kept
 * out of `app.tsx` so that file does not grow by a feature; `App` hands in the
 * terminal layer and its overlay preflight, and mounts `view`.
 */
export interface MissionControlDeps {
  readonly tabs: () => TabManager | null;
  /** `.stage__tabs`: what slides, and where the swipe is read. */
  readonly stage: () => HTMLElement | null;
  /** Another overlay covers the stage, so the chord must not open over it. */
  readonly blocked: () => boolean;
  /** A document or the browser holds the stage: there is no pane to zoom from. */
  readonly surfaceActive: () => boolean;
  /** The terminal face the slide's ghost text is set in. */
  readonly font: () => { readonly family: string; readonly size: number };
}

export interface MissionControlHandle {
  readonly toggle: () => void;
  /** `TabManagerDeps.onTabSwitch`. */
  readonly onTabSwitch: (from: number, to: number) => (() => void) | void;
  readonly view: JSX.Element | null;
}

interface Opening {
  readonly fromRects: readonly PaneRect[];
  readonly focusedPaneId: number | null;
}

/** Every tab, in the strip's own order but unscoped: Mission Control shows all. */
function allSpaces() {
  return buildSpaces({
    tabs: tabViews.value,
    // The rail's order, as the strip's marks are (DL-35.3).
    order: currentSpaceOrder(),
    activeIndex: activeTabIndex.value,
    scans: repositoryScans.value,
  });
}

function slideDirection(order: readonly number[], from: number, to: number): SlideDirection | null {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  return a < 0 || b < 0 || a === b ? null : b > a ? 1 : -1;
}

export function useMissionControl(deps: MissionControlDeps): MissionControlHandle {
  const [opening, setOpening] = useState<Opening | null>(null);
  const leaveRef = useRef<((exit: MissionExit) => void) | null>(null);
  /**
   * True from an exit's switch until its zoom lands: Mission Control itself
   * moved the tab, so the zoom carries the change — no slide, no dismissal.
   * A ref and not a flag scoped to the call, because `useSignalEffect` sees
   * the switch a frame later.
   */
  const exiting = useRef(false);
  /**
   * Which opening an exit belongs to. A chord can dismiss Mission Control
   * mid-zoom and reopen it inside 280 ms; the first opening's zoom still
   * settles, and must not close the second.
   */
  const generation = useRef(0);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  // Lazy, so the slider is built once rather than on every `App` render.
  const [slider] = useState(() =>
    createSpaceSlider({
      stage: () => depsRef.current.stage(),
      rects: () => depsRef.current.tabs()?.activeSlotRects() ?? [],
      snapshot: (paneId, rows) => depsRef.current.tabs()?.serializePane(paneId, rows) ?? null,
      font: () => depsRef.current.font(),
    }),
  );
  /** What had focus when Mission Control opened, so "back" can return it there. */
  const opener = useRef<HTMLElement | null>(null);

  const open = (): void => {
    const tabs = deps.tabs();
    if (tabs === null || tabViews.value.length === 0 || deps.blocked()) return;
    slider.finish();
    generation.current += 1;
    exiting.current = false;
    leaveRef.current = null;
    const origin = document.activeElement;
    // <body> is "nothing had focus"; returning there would leave keys nowhere.
    opener.current = origin instanceof HTMLElement && origin !== document.body ? origin : null;
    setOpening({
      fromRects: deps.surfaceActive() ? [] : tabs.activeSlotRects(),
      focusedPaneId: tabs.activePaneId(),
    });
    missionControlOpen.value = true;
  };

  const toggle = (): void => {
    if (!missionControlOpen.value) open();
    else if (leaveRef.current !== null) leaveRef.current({ kind: "back" });
    else dismissMissionControl();
  };

  // Anything else that closes it — a tab switch by chord, the last tab
  // closing — drops the picture without a zoom.
  useSignalEffect(() => {
    if (!missionControlOpen.value) {
      setOpening(null);
      // A dismissal mid-zoom never reaches `done`; nothing is exiting now.
      exiting.current = false;
    } else if (tabViews.value.length === 0 || depsRef.current.blocked()) {
      // No tab left to show, or another overlay (Settings, a modal, the Open
      // board) opened over it: Mission Control yields rather than keep
      // answering Escape and Tab from under that surface.
      dismissMissionControl();
    }
  });

  // A strip or rail press switches the tab outside Mission Control's own
  // exits; the surface would then describe a stage it no longer covers.
  // Compared by tab KEY: closing a tab to the left moves the active index
  // without any switch, and a neighbour taking a closed tab's index is one.
  const activeKey = (): number | null => tabViews.value[activeTabIndex.value]?.key ?? null;
  const seenKey = useRef(activeKey());
  useSignalEffect(() => {
    const key = activeKey();
    if (key !== seenKey.current && missionControlOpen.value && !exiting.current) {
      dismissMissionControl();
    }
    seenKey.current = key;
  });

  useEffect(() => () => slider.finish(), [slider]);

  const onTabSwitch = (from: number, to: number): (() => void) | void => {
    if (exiting.current || missionControlOpen.value) return;
    const direction = slideDirection(depsRef.current.tabs()?.spaceOrder() ?? [], from, to);
    return direction === null ? undefined : slider.capture(direction);
  };

  const step = (direction: SlideDirection): void => {
    const tabs = deps.tabs();
    if (tabs === null || missionControlOpen.value || deps.blocked() || deps.surfaceActive()) return;
    const order = tabs.spaceOrder();
    const at = order.indexOf(activeTabIndex.value);
    const next = at < 0 ? undefined : order[at + direction];
    if (next !== undefined) tabs.selectTab(next);
  };
  useSpaceSwipe(deps.stage, step);

  const exit = (choice: MissionExit): void => {
    const tabs = deps.tabs();
    if (tabs === null || choice.kind === "back") return;
    exiting.current = true;
    if (choice.kind === "pane") tabs.activateForAttention(choice.space.tabIndex, choice.paneId);
    else tabs.selectTab(choice.space.tabIndex);
  };

  const done = (choice: MissionExit, opened: number): void => {
    if (opened !== generation.current || !missionControlOpen.value) return;
    exiting.current = false;
    leaveRef.current = null;
    dismissMissionControl();
    if (choice.kind === "pane") return;
    // "back" returns focus to what opened it — the toolbar button, or the
    // pane the chord was pressed in — when that is still in the document.
    const origin = opener.current;
    if (choice.kind === "back" && origin !== null && origin.isConnected) origin.focus();
    else deps.tabs()?.focusActive();
  };

  const openedAs = generation.current;
  const view =
    missionControlOpen.value && opening !== null ? (
      <MissionControl
        // One instance per opening, so a dismissal and a reopen in the same
        // render cannot inherit the old instance's `left` flag.
        key={openedAs}
        spaces={allSpaces()}
        snapshot={(paneId) => deps.tabs()?.serializePane(paneId, WINDOW_ROWS) ?? ""}
        caption={(paneId) => paneTails.value.get(paneId) ?? ""}
        focusedPaneId={opening.focusedPaneId}
        fromRects={opening.fromRects}
        leaveRef={leaveRef}
        onExit={exit}
        landingRects={() => deps.tabs()?.activeSlotRects() ?? []}
        onDone={(choice) => done(choice, openedAs)}
      />
    ) : null;

  return { toggle, onTabSwitch, view };
}
