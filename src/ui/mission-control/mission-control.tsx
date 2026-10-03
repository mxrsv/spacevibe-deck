import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { PaneRect } from "../../lib/pane-geometry";
import { trapTab } from "../focus-trap";
import { fade, flyFrom, flyTo, settled, type Box } from "../spaces/space-motion";
import type { Space } from "../spaces/space-model";
import { MissionWindow } from "./mission-window";
import { ShelfSpace } from "./mission-shelf-space";

/**
 * Mission Control (DL-35.1): the current space's panes zoom out into a spread
 * of windows, with every space thumbnailed on a shelf above. Hover or focus a
 * thumbnail to preview its windows; press a window to return to that pane,
 * press a thumbnail to enter its space; Esc, the empty area or the chord again
 * returns unchanged.
 *
 * Every window is a snapshot (`serializePane`), so Mission Control is never a
 * second owner of a live terminal; the tab underneath stays shown, covered.
 * On the way back in, the switch happens UNDER the surface first, then the
 * windows fly onto the panes' real rects while the rest fades.
 */

/** A surface stacked over Mission Control that owns its own Escape and Tab. */
const OTHER_LAYER = '[role="menu"], [role="dialog"], [role="alertdialog"]';

/** Rows of scrollback a window shows; its box clips the rest. */
export const WINDOW_ROWS = 14;

export type MissionExit =
  | { readonly kind: "pane"; readonly space: Space; readonly paneId: number }
  | { readonly kind: "space"; readonly space: Space }
  | { readonly kind: "back" };

export interface MissionControlProps {
  /** Every space in the window, not only the active repository's (DL-35.1). */
  readonly spaces: readonly Space[];
  readonly snapshot: (paneId: number) => string;
  readonly caption: (paneId: number) => string;
  /** The focused pane of the current space, where focus starts. */
  readonly focusedPaneId: number | null;
  /** The current space's pane rects when the chord was pressed. */
  readonly fromRects: readonly PaneRect[];
  /** Carry out an exit on the stage underneath, synchronously. */
  readonly onExit: (exit: MissionExit) => void;
  /** Name a space from its thumbnail, or clear its name with `null`. */
  readonly onRename: (space: Space, name: string | null) => void;
  /** The current space's pane rects, read after `onExit` switched it. */
  readonly landingRects: () => readonly PaneRect[];
  /** The zoom-in has finished; unmount. */
  readonly onDone: (exit: MissionExit) => void;
  /** Filled with this surface's exit, so the chord and the toolbar can leave through it. */
  readonly leaveRef: { current: ((exit: MissionExit) => void) | null };
}

interface Project {
  readonly key: string;
  readonly label: string;
  readonly spaces: readonly Space[];
}

/** Spaces grouped by project, each group where its first space stands. */
function byProject(spaces: readonly Space[]): readonly Project[] {
  return spaces.reduce<readonly Project[]>((groups, space) => {
    const found = groups.find((group) => group.key === space.group);
    return found === undefined
      ? [...groups, { key: space.group, label: space.groupLabel, spaces: [space] }]
      : groups.map((group) =>
          group === found ? { ...group, spaces: [...group.spaces, space] } : group,
        );
  }, []);
}

function rectsById(rects: readonly PaneRect[]): ReadonlyMap<number, Box> {
  return new Map(rects.map((rect) => [rect.id, rect]));
}

function Shelf(props: {
  readonly spaces: readonly Space[];
  readonly previewKey: number | null;
  readonly onPreview: (space: Space) => void;
  readonly onEnter: (space: Space) => void;
  readonly onRename: (space: Space, name: string | null) => void;
}) {
  return (
    <div class="mc-shelf" role="group" aria-label="Spaces">
      {byProject(props.spaces).map((workspace) => (
        <div key={workspace.key} class="mc-shelf__set">
          <span class="mc-shelf__folder">{workspace.label}</span>
          <div class="mc-shelf__row">
            {workspace.spaces.map((space) => (
              <ShelfSpace
                key={space.key}
                space={space}
                previewed={space.key === props.previewKey}
                onPreview={props.onPreview}
                onEnter={props.onEnter}
                onRename={props.onRename}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MissionControl(props: MissionControlProps) {
  const root = useRef<HTMLDivElement>(null);
  const current = props.spaces.find((space) => space.current) ?? props.spaces[0];
  const [previewKey, setPreviewKey] = useState<number | null>(current?.key ?? null);
  const [leaving, setLeaving] = useState(false);
  /** Synchronous twin of `leaving`: two exits in one tick must not both run. */
  const left = useRef(false);
  const previewed = props.spaces.find((space) => space.key === previewKey) ?? current;
  // Read once per previewed space: the spread is a still picture (DL-1.2 —
  // nothing moves while the user is idle), refreshed when the preview moves.
  const shots = useMemo(
    () =>
      new Map((previewed?.panes ?? []).map((pane) => [pane.paneId, props.snapshot(pane.paneId)])),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on the preview; `snapshot` is a fresh closure every render
    [previewed?.key],
  );

  // The zoom-out: each window of the current space flies from its pane.
  /* oxlint-disable react-hooks/exhaustive-deps -- open-once: the zoom-out and first focus belong to the mount */
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    const from = rectsById(props.fromRects);
    element.querySelectorAll<HTMLElement>(".mc-window__shot[data-pane]").forEach((shot) => {
      const rect = from.get(Number(shot.dataset.pane));
      if (rect !== undefined) flyFrom(shot, rect);
    });
    fade(element.querySelector(".mc__backdrop"), "in");
    fade(element.querySelector(".mc-shelf"), "in");
    const start =
      element.querySelector<HTMLElement>(`.mc-window[data-pane="${props.focusedPaneId}"]`) ??
      element.querySelector<HTMLElement>(".mc-window, .mc-space");
    start?.focus({ preventScroll: true });
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */

  const leave = (exit: MissionExit): void => {
    const element = root.current;
    if (left.current || element === null) return;
    left.current = true;
    setLeaving(true);
    props.onExit(exit);
    const landing = rectsById(props.landingRects());
    const animations = [...element.querySelectorAll<HTMLElement>(".mc-window")].map((item) => {
      const shot = item.querySelector<HTMLElement>(".mc-window__shot");
      const rect = landing.get(Number(item.dataset.pane));
      return shot !== null && rect !== undefined ? flyTo(shot, rect) : fade(item, "out");
    });
    void settled([
      ...animations,
      fade(element.querySelector(".mc__backdrop"), "out"),
      fade(element.querySelector(".mc-shelf"), "out"),
    ]).then(() => props.onDone(exit));
  };
  props.leaveRef.current = leave;
  const leaveNow = useRef(leave);
  leaveNow.current = leave;

  // Escape and Tab are answered at the document, as the modal shell does
  // (DL-29): a press on a label drops focus to <body>, and a Tab that left
  // the dialog would land in the covered pane's xterm and type into a PTY
  // nobody can see.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A newer layer over Mission Control — a strip or mark menu, a tooltip
      // — answers its own keys; one Escape must not close both.
      const active = document.activeElement;
      const layer = active instanceof Element ? active.closest(OTHER_LAYER) : null;
      if (layer !== null && layer !== root.current) return;
      // A rename field answers its own Escape (it cancels the edit); one
      // press must not also close Mission Control.
      if (event.key === "Escape" && active instanceof Element && active.closest(".space-rename")) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        leaveNow.current({ kind: "back" });
      } else if (event.key === "Tab") {
        trapTab(event, root.current, root.current);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div
      ref={root}
      class="mc"
      role="dialog"
      aria-modal="true"
      aria-label="Mission Control"
      // Somewhere for focus to rest when a press lands on a label or a gap.
      tabIndex={-1}
      data-leaving={leaving ? "true" : undefined}
    >
      <div class="mc__backdrop" aria-hidden="true" />
      <Shelf
        spaces={props.spaces}
        previewKey={previewed?.key ?? null}
        onPreview={(space) => setPreviewKey(space.key)}
        onEnter={(space) => leave({ kind: "space", space })}
        onRename={props.onRename}
      />
      <div
        class="mc__spread"
        onClick={(event) => {
          if (event.target === event.currentTarget) leave({ kind: "back" });
        }}
      >
        {(previewed?.panes ?? []).map((pane) => (
          <MissionWindow
            key={pane.paneId}
            pane={pane}
            snapshot={shots.get(pane.paneId) ?? ""}
            caption={props.caption(pane.paneId)}
            focused={previewed?.current === true && pane.paneId === props.focusedPaneId}
            onChoose={(paneId) =>
              previewed !== undefined && leave({ kind: "pane", space: previewed, paneId })
            }
          />
        ))}
      </div>
    </div>
  );
}
