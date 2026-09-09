import { Fragment } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  ArrowElbowDownRight,
  FolderOpen,
  FolderPlus,
  Gear,
  GitFork,
  Info,
  SquareHalf,
  TerminalWindow,
} from "@phosphor-icons/react";
import { WorktreeColorPicker } from "./worktree-color-picker";
import { AgentGlyph } from "./controls/agent-glyph";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import { CardAgentRow, whereOf } from "./worktree-card-row";
import { displayAgent, subjectWhere, type MenuSubject } from "./agent-rail-card-model";
import { railCardMenuOpen } from "../chrome/events";
import type { RailCardPane, RailWorktreeGroup } from "./agent-rail-model";

/**
 * The two popovers a closed worktree card raises (spec
 * `docs/specs/2026-08-27-rail-card-strip-actions-design.md` §5 and §8).
 *
 * Both are anchored to a card that lives inside `.asr-rail__list` — a scroll
 * container with `overflow-x: hidden`. A surface rendered INSIDE it is clipped
 * on the left and scrolls away from its own trigger, which is why everything
 * here is `position: fixed` off the trigger's client rect (spec §5.1). The
 * precedents are `tooltipAnchor()` (`controls/action-tooltip.tsx`) and
 * `MenuAnchor` (`toolbar/toolbar-overflow-menu.tsx`); the gallery specimen
 * drew them `absolute` and its own header says not to inherit that.
 *
 * PLACEMENT: both surfaces open to the right, 6px away, flipping left when
 * they would pass the viewport. The segment menu starts below its trigger;
 * the anchored actions menu stays top-aligned (spec §8.2).
 *
 * DL amendments this carries (spec §11.2): DL-13.1's 12px `--radius-surface`
 * is scoped to stage-level surfaces and these take the card's 6px instead;
 * DL §13 admits a hover-raised popover and a two-line menu row.
 */

/** Gap between a trigger and its surface, and the viewport margin it keeps. */
const SURFACE_GAP = 6;
const SURFACE_EDGE = 8;

interface Placement {
  readonly left: number;
  readonly top: number;
}

/** The four edges a placement reads — a `DOMRect`, or a literal for a surface with no trigger. */
export type AnchorRect = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

/**
 * Which side of the anchor the surface hangs off. `right` is the rail's
 * placement (spec §8.2). `below` is the keyboard-raised actions menu's
 * (`openspec/changes/rail-create-consolidation`, design D1): it hangs under the
 * stage strip at the strip's leading edge, because a chord has no control on
 * screen to sit beside.
 */
type PlacementSide = "right" | "bottom-right" | "below";

/**
 * Place a fixed surface beside `rect`, flipping and clamping against the
 * viewport. Measured off the surface itself, because a flip needs its width
 * and a bottom clamp needs its height — neither is known before it mounts, and
 * both change with the row set (the Tauri menu is ~70px shorter, spec §10).
 */
export function useSurfacePlacement(
  rect: AnchorRect | null,
  side: PlacementSide = "right",
): {
  readonly ref: { current: HTMLDivElement | null };
  readonly style: Record<string, string>;
  /** True once the surface has been measured and is visible. */
  readonly placed: boolean;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || rect === null) {
      return;
    }
    const measure = (): void => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      let left: number;
      let top: number;
      if (side === "below") {
        // Under the anchor, leading edges aligned, clamped so the surface never
        // leaves the viewport on the right or the bottom.
        left = Math.max(
          SURFACE_EDGE,
          Math.min(rect.left, window.innerWidth - SURFACE_EDGE - width),
        );
        top = Math.max(
          SURFACE_EDGE,
          Math.min(rect.bottom + SURFACE_GAP, window.innerHeight - SURFACE_EDGE - height),
        );
      } else {
        const right = rect.right + SURFACE_GAP;
        const fitsRight = right + width <= window.innerWidth - SURFACE_EDGE;
        left = fitsRight ? right : Math.max(SURFACE_EDGE, rect.left - SURFACE_GAP - width);
        top = Math.max(
          SURFACE_EDGE,
          Math.min(
            side === "bottom-right" ? rect.bottom + SURFACE_GAP : rect.top,
            window.innerHeight - SURFACE_EDGE - height,
          ),
        );
      }
      // Preact bails on an equal value, so re-measuring a surface that did not
      // move costs one comparison rather than a render.
      setPlace((current) =>
        current !== null && current.left === left && current.top === top ? current : { left, top },
      );
    };
    measure();
    // A surface that GROWS after it opens keeps a clamp computed for its old
    // height, and `rect` — the anchor — has not changed, so nothing else
    // re-runs this. Both menus do grow: the actions menu swaps its
    // `Looking for installed agents…` note for N agent rows when discovery
    // lands (2026-08-30), and a segment menu gains or loses rows as panes join
    // or leave the group it raised. Near the bottom of the window that left the
    // new rows below `innerHeight` — and `.asr-pop`'s `overflow-y` only engages
    // at `max-height`, which the surface has not reached, so they were simply
    // unreachable. Guarded exactly as `feature-toolbar.tsx` and
    // `file-tree-view.tsx` guard theirs: the test environment has no
    // `ResizeObserver`, and the first `measure()` above is what those runs use.
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [rect, side]);

  return {
    ref,
    style:
      place === null
        ? // One frame before it is measured. `hidden` rather than unmounted so
          // the layout effect above has a box to read.
          { visibility: "hidden", left: "0px", top: "0px" }
        : { left: `${place.left}px`, top: `${place.top}px` },
    placed: place !== null,
  };
}

/**
 * Escape, an outside pointer press, and any scroll close the surface. The
 * scroll listener is what a `fixed` surface needs that an `absolute` one does
 * not: it no longer follows its anchor, so staying open would leave it beside
 * a card that has moved (spec §5.1).
 *
 * Lifted from `ToolbarOverflowMenu`'s own document-capture listeners rather
 * than re-invented, including the trigger exemption — the trigger's own click
 * toggles, so it must not close through this path too.
 */
export function useDismiss(
  onClose: () => void,
  surface: { readonly current: HTMLElement | null },
  trigger: HTMLElement | null,
): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (surface.current?.contains(target) === true || trigger?.contains(target) === true) {
        return;
      }
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      onClose();
      // `Modal`'s own three lines (2026-08-19), for its own reason: a terminal
      // is one element away and reads raw keys, so an Escape that only closed
      // this surface and kept travelling would ALSO reach the agent running
      // behind it. Until 2026-08-31 this listener was on the BUBBLE phase with
      // no `stopPropagation`, so one press did both — xterm's target-phase
      // handler sent `\x1b` first and the menu closed after it.
      event.preventDefault();
      event.stopPropagation();
    };
    const onScroll = (event: Event): void => {
      // The SURFACE's own scrollbar is not the anchor moving. `.asr-pop` caps
      // at `calc(100vh - 16px)` with `overflow-y: auto`, so on a short window
      // the actions menu scrolls — and a capture-phase listener sees that
      // scroll too. Closing on it would make the menu impossible to read.
      const target = event.target;
      if (target instanceof Node && surface.current?.contains(target) === true) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose, surface, trigger]);
}

/**
 * Both surfaces are placed over the STAGE, where the browser tab's
 * `WebContentsView` is a NATIVE layer above the renderer — so while either is
 * up, `browserPanelObscured` has to hide that view or the menu draws
 * underneath it. `agentQuickPickerOpen` learned the same lesson on 2026-08-16.
 *
 * Reference-counted rather than a plain boolean: hovering one card's segment
 * while another card's actions menu is open puts two surfaces on screen, and
 * the first to unmount would otherwise clear the flag out from under the
 * second.
 *
 * **The release is delayed (2026-08-31, code review).** Every precedent on
 * `browserPanelObscured` is a CLICK-opened surface, raised once and dismissed
 * once. A segment menu is raised by a 120ms hover, so sweeping the pointer
 * across a three-segment strip tore the native view down and rebuilt it three
 * times and re-rendered `App` six. Holding the flag through the gap between
 * one menu closing and the next opening makes a sweep one hide instead of
 * three; a pointer that leaves the rail entirely pays this delay once.
 *
 * **What is NOT fixed, and is the owner's call:** a hover still hides the
 * whole browser page for as long as the menu is up. That is the correct
 * behaviour for a surface drawn over a native view — the alternative is a menu
 * nobody can see — but "reading a web page and passing the pointer over the
 * rail blanks it" is an interaction question, not a bug this can settle. The
 * fix for that is raising the segment menu on CLICK while a browser surface
 * holds the stage, which changes DL-13.7's hover contract.
 */
const OVERLAY_RELEASE_MS = 260;

let openCardMenus = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

export function useStageOverlayFlag(): void {
  useEffect(() => {
    openCardMenus += 1;
    if (releaseTimer !== null) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }
    railCardMenuOpen.value = true;
    return () => {
      openCardMenus -= 1;
      if (openCardMenus > 0) {
        return;
      }
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        // Re-checked rather than assumed: a menu that mounted and unmounted
        // again inside the delay leaves the count back at 0, but one that
        // mounted and STAYED must not have the flag cleared under it.
        if (openCardMenus === 0) {
          railCardMenuOpen.value = false;
        }
      }, OVERLAY_RELEASE_MS);
    };
  }, []);
}

/* ─────────────────────────────────── the segment menu (spec §5) ───────────── */

export interface SegmentMenuProps {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  /** The panes behind the raised segment, loudest first. */
  readonly panes: readonly RailCardPane[];
  /** The raised segment's client rect; null while it is being re-measured. */
  readonly rect: DOMRect | null;
  /** The segment itself — exempt from the outside-press close, since its own
   * press is a focus rather than a dismissal. */
  readonly trigger: HTMLElement | null;
  /** `null` for the `+N` tail, an agent id for a segment. */
  readonly agent: string | null;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
  readonly onClose: () => void;
  /** Keeps the menu up while the pointer is inside it (the bridge, spec §5.1). */
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
}

/**
 * The panes behind one segment — one shape, three cases (spec §5): a merged
 * a merged Claude segment raises its two panes under a caption, a single-pane segment
 * raises that pane plus an explicit `Focus pane` row, and the `+N` tail raises
 * exactly the panes it hides.
 *
 * The rows are the production `.asr-card__row` (`CardAgentRow`), so press,
 * ✕, the model pill and the hover wash arrive on existing seams. The
 * `Focus pane` row exists because a one-row list IS the segment — without it
 * the menu would say nothing the segment did not. That is this shape's own
 * accepted cost, drawn in the gallery before it was chosen.
 */
export function SegmentMenu(props: SegmentMenuProps) {
  const { ref, style } = useSurfacePlacement(props.rect, "bottom-right");
  useDismiss(props.onClose, ref, props.trigger);
  useStageOverlayFlag();
  const only = props.panes.length === 1 ? props.panes[0] : undefined;
  // "1 Claude agents" until 2026-08-31 (code review): the visible caption was
  // guarded by `panes.length > 1`, but the label a screen reader actually
  // speaks was not — and the single-pane case is the COMMON one, since a
  // checkout with one agent of a kind is the default shape.
  const count = props.panes.length;
  const noun = count === 1 ? "agent" : "agents";
  const where = whereOf(props.project, props.group);

  return (
    <div
      ref={ref}
      class="asr-pop asr-pop--panes"
      role="dialog"
      aria-label={
        props.agent === null
          ? `${count} more ${noun} in ${where}`
          : `${count} ${displayAgent(props.agent)} ${noun} in ${where}`
      }
      style={style}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
    >
      {props.panes.length > 1 && (
        <p class="asr-pop__cap">
          {props.panes.length}{" "}
          {props.agent === null ? "more in this checkout" : `${displayAgent(props.agent)} agents`}
        </p>
      )}
      {props.panes.map((pane) => (
        <CardAgentRow
          key={pane.paneId}
          project={props.project}
          group={props.group}
          pane={pane}
          // Open question 1, settled here: a press CLOSES the menu. Focusing a
          // pane moves the keyboard to it, and a surface that outlives that
          // would be a menu hovering beside a terminal the user is typing in.
          onFocusPane={(tabIndex, paneId) => {
            props.onFocusPane(tabIndex, paneId);
            props.onClose();
          }}
          onClosePane={props.onClosePane}
        />
      ))}
      {only !== undefined && (
        <Fragment>
          <div class="asr-pop__sep" />
          <button
            type="button"
            class="asr-card__new"
            aria-label={`Focus ${only.label} in ${whereOf(props.project, props.group)}`}
            onClick={() => {
              props.onFocusPane(only.tabIndex, only.paneId);
              props.onClose();
            }}
          >
            <span class="asr-card__glyph asr-card__glyph--new" aria-hidden="true">
              <DeckIcon icon={ArrowElbowDownRight} size={CHROME_ICON} />
            </span>
            <span class="asr-card__name">Focus pane</span>
          </button>
        </Fragment>
      )}
    </div>
  );
}

/* ─────────────────────────────────── the actions menu (spec §8) ───────────── */

/** One agent the actions menu can launch into this checkout. */
export interface CardActionAgent {
  readonly id: string;
  readonly label: string;
  /**
   * The second line: the agent's default MODEL where the settings carry one,
   * and the command it will actually run where they do not (spec §8.1). Only
   * the first of those is a fact a row can promise.
   */
  readonly detail: string;
}

/**
 * What a card's actions menu can do. Every entry maps to a seam that already
 * exists — **no new IPC** (spec §8), which is the finding that makes this menu
 * cheap. A callback left undefined omits its row entirely rather than showing
 * it inert (DL-19.7), which is how the Tauri column loses `worktree_add` and
 * both `open_in_app` rows.
 */
export interface CardActions {
  readonly agents: readonly CardActionAgent[];
  /**
   * Whether agent discovery has ANSWERED yet — `agentsProbed`, the third state
   * between "no agent is installed" and "we have not looked".
   *
   * It is here because `agents` alone cannot carry it: `agentOptions` emits a
   * built-in only when the probe returned a path for it, so a probe that has
   * not landed and a machine with nothing installed both arrive as `[]`. The
   * menu used to drop that empty group silently, which is how the surface
   * built to launch agents came to offer none. The launcher learned this on
   * 2026-08-24 (`launcher-fields.tsx`'s `agentsResolved`); the menu inherits
   * the same fact rather than a second guess at it.
   */
  readonly agentsResolved: boolean;
  /** `openQuickAgent(agentId, destination)` — the destination overrides both
   * cwd and workspace tag, which is what that argument was built for. */
  onRunAgent(agentId: string, workspacePath: string): void;
  /**
   * Open Settings for a checkout with no agent to run — the quick picker's own
   * escape hatch (`onManageAgents`), which lands on Settings' first category
   * because Settings takes no initial one. Optional, so a caller that cannot
   * open Settings states the absence as a note instead of drawing a control
   * nothing wires (DL-19.7).
   */
  onManageAgents?(): void;
  /** `TabManager.splitInWorkspace` — materialize-then-split (spec §11.1). */
  onSplitHere(workspacePath: string): void;
  /** Quick Launch's create-worktree subview, prefilled with this repository. */
  onCreateBranch?(repoPath: string): void;
  /** `open_in_app` with the catalog's `finder` entry. */
  onOpenFolder?(path: string): void;
  /** `open_in_app` with the catalog's terminal entry. */
  onOpenTerminal?(path: string): void;
  /** The installed app each OS row will actually launch, for its detail line. */
  readonly filesAppLabel?: string;
  readonly terminalAppLabel?: string;
  /**
   * Raise the Open board — the `Open another project…` row, rendered ONLY by
   * the free-standing placement (`rail-create-consolidation`, design D1): with
   * the tab strip's `+` gone, top-tab mode and a hidden sidebar have no mouse
   * route to the board, so the chord's own list has to carry one. A card's
   * anchored menu never renders it — the sidebar's `+ New` is on screen there.
   */
  onOpenBoard?(): void;
}

/**
 * Where the actions menu stands (`rail-create-consolidation`, design D1).
 * `anchored` hangs off a card or checkout row and prints no heading, because
 * the card 6px away states the subject (DL-27.25, amended 2026-08-30).
 * `free-standing` is `⌘T`'s: no card is beside it, so it states its subject in
 * a heading and hangs under the stage strip (DL-13.7, amended).
 */
export type MenuPlacement = "anchored" | "free-standing";

/** A pressable row: icon · title · detail (DL-13.8). */
interface ActionRow {
  readonly kind: "action";
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly agent?: string;
  readonly glyph?: keyof typeof ACTION_GLYPHS;
  readonly run: () => void;
}

/**
 * A row that states a fact and cannot be pressed — the agent group while
 * discovery is still running.
 *
 * Not an `ActionRow` with a dead `run`, and deliberately not a `<button>`: the
 * menu's roving focus walks `querySelectorAll("button")`, so an inert button
 * would take a stop in the Arrow-key order and do nothing there.
 */
interface NoteRow {
  readonly kind: "note";
  readonly id: string;
  readonly text: string;
}

type MenuRow = ActionRow | NoteRow;

/**
 * The row glyphs. `split` and `branch` were chosen by the owner on 2026-08-30
 * from eight candidates drawn in the gallery
 * (`gallery/sections/action-glyph-variants.tsx`, parked with the choice):
 *
 * - `split` was `ColumnsPlusRight` — two columns and a plus, which reads as
 *   adding a column of CHROME rather than splitting the pane the row acts on.
 *   `SquareHalf` draws the outcome: one pane divided.
 * - `branch` was `GitBranch`, the SAME picture the card's own branch badge
 *   draws two tiers above the menu. `GitFork` was chosen with its cost stated
 *   at the time and accepted: at 13px it is close to `GitBranch`, so the
 *   collision is reduced rather than removed.
 */
const ACTION_GLYPHS = {
  split: SquareHalf,
  branch: GitFork,
  finder: FolderOpen,
  terminal: TerminalWindow,
  agents: Gear,
  // `Open another project…` — a folder being added, distinct from `finder`'s
  // open folder two rows above it (the glyph-uniqueness rule the 2026-08-30
  // change recorded for this column).
  board: FolderPlus,
} as const;

/**
 * The agent group — the menu's whole reason for existing, so it is never
 * silently absent.
 *
 * DL-19.7 omits a control the host CANNOT wire. A probe that has not answered
 * yet is not that: it is a question in flight, and dropping the group made the
 * two indistinguishable on screen. Three shapes, one per state of
 * `(agentsResolved, agents)` — the pair is exhaustive, since a non-empty list
 * can only come from a settled probe.
 */
function agentRows(actions: CardActions, subject: MenuSubject): readonly MenuRow[] {
  if (!actions.agentsResolved) {
    return [
      {
        kind: "note",
        id: "agents-pending",
        text: "Looking for installed agents…",
      },
    ];
  }
  if (actions.agents.length === 0) {
    const manage = actions.onManageAgents;
    return manage === undefined
      ? [{ kind: "note", id: "agents-none", text: "No agent is installed and enabled" }]
      : [
          {
            kind: "action",
            id: "agents-settings",
            title: "No agent to run",
            detail: "Open Settings to add one",
            glyph: "agents",
            run: manage,
          },
        ];
  }
  return actions.agents.map((agent) => ({
    kind: "action",
    id: `run:${agent.id}`,
    title: `Run ${agent.label}`,
    detail: agent.detail,
    agent: agent.id,
    run: () => {
      actions.onRunAgent(agent.id, subject.path);
    },
  }));
}

/**
 * The row groups, with every host-gated row dropped rather than disabled
 * (DL-19.7). Pure over the actions and the checkout, so the row set a host
 * produces is assertable without mounting the menu.
 */
export function actionGroups(
  actions: CardActions,
  subject: MenuSubject,
  placement: MenuPlacement = "anchored",
): readonly (readonly MenuRow[])[] {
  const agents = agentRows(actions, subject);

  const work: ActionRow[] = [
    {
      kind: "action",
      id: "split",
      title: "New split here",
      detail: "Open a pane beside this tab",
      glyph: "split",
      run: () => {
        actions.onSplitHere(subject.path);
      },
    },
  ];
  const createBranch = actions.onCreateBranch;
  // Dropped, not disabled, for a checkout git does not know (DL-19.7): a
  // plain folder has no branch to fork from, and `subject.branch` is null
  // there — the row would have promised `Branch off null`.
  if (createBranch !== undefined && subject.labelled && subject.branch !== null) {
    const branch = subject.branch;
    work.push({
      kind: "action",
      id: "branch",
      title: "Create branch from here",
      detail: `Branch off ${branch}`,
      glyph: "branch",
      run: () => {
        // The REPOSITORY, not this checkout (code review, 2026-08-31):
        // `worktree_add` runs against a repository, and passing a linked
        // worktree made `suggestWorktreeDest` propose a destination beside
        // that worktree instead of beside the repository. `Branch off
        // <branch>` above is still this checkout's branch — that half was
        // always right, and it is what "from here" means.
        createBranch(subject.repositoryPath);
      },
    });
  }

  const os: ActionRow[] = [];
  const openFolder = actions.onOpenFolder;
  if (openFolder !== undefined) {
    os.push({
      kind: "action",
      id: "finder",
      title: `Open in ${actions.filesAppLabel ?? "Finder"}`,
      detail: "Reveal this folder",
      glyph: "finder",
      run: () => {
        openFolder(subject.path);
      },
    });
  }
  const openTerminal = actions.onOpenTerminal;
  if (openTerminal !== undefined) {
    os.push({
      kind: "action",
      id: "terminal",
      title: "Open terminal here",
      detail: actions.terminalAppLabel ?? "Launch your terminal app",
      glyph: "terminal",
      run: () => {
        openTerminal(subject.path);
      },
    });
  }

  // The chord's list is COMPLETE on its own (`rail-create-consolidation`,
  // design D1 and D6): the tab strip's `+` is gone in both layouts, and
  // top-tab mode has no sidebar, so a hidden sidebar or that layout would
  // otherwise leave no route to the Open board at all. The anchored menu never
  // carries it — DL-27.14's `+ New` is on screen beside the rail there.
  const board: ActionRow[] = [];
  const openBoard = actions.onOpenBoard;
  if (placement === "free-standing" && openBoard !== undefined) {
    board.push({
      kind: "action",
      id: "board",
      title: "Open another project…",
      detail: "Add a folder or worktree",
      glyph: "board",
      run: openBoard,
    });
  }

  return [agents, work, os, board].filter((rows) => rows.length > 0);
}

export interface CardActionsMenuProps {
  /** What the rows act on — a card's group reduced by `subjectOf`, or the
   * active workspace's by `subjectForWorkspace` for the keyboard placement. */
  readonly subject: MenuSubject;
  readonly actions: CardActions;
  /** Defaults to `anchored`. */
  readonly placement?: MenuPlacement;
  /** The card's client rect — the menu hangs off the CARD, not the cursor.
   * Ignored by the free-standing placement, which anchors under the stage
   * strip and reads that rect itself. */
  readonly rect: AnchorRect | null;
  /** The `+` segment — exempt from the outside-press close, or its own click
   * would reopen the menu the press had just closed. */
  readonly trigger: HTMLElement | null;
  readonly onClose: () => void;
}

/**
 * Where the keyboard-raised menu hangs: under the tab strip, at its leading
 * edge. `.stage__strip` is sidebar mode's mount and `.tabbar` top-tab mode's
 * frame (DL-18.6) — one of the two is in the tree in every layout. The fallback
 * is the viewport's own inset, so a strip that has not mounted yet (a test, the
 * gallery) still places the surface rather than hiding it forever.
 */
function stripAnchor(): AnchorRect {
  // `[data-strip-anchor]` first: a specimen (the gallery's popovers section)
  // stands in for the strip so the surface can be reviewed under its own pad
  // rather than under whichever real strip the page happens to hold.
  const strip = document.querySelector("[data-strip-anchor], .stage__strip, .tabbar");
  if (strip !== null) {
    return strip.getBoundingClientRect();
  }
  return { left: SURFACE_EDGE, top: 0, right: SURFACE_EDGE, bottom: 0 };
}

/**
 * Header, groups, footer — the owner's own reference, mapped onto seams that
 * already exist (spec §8).
 *
 * Two departures from that reference, both named rather than slipped in
 * (spec §8.1): the reference states the checkout name twice, so the second
 * line spends its width on the fact the card does NOT already show — the
 * branch; and an agent row's detail is its default model or the command it
 * will run, never a vendor or a restatement of the scope the footer states
 * once.
 *
 * A two-line menu row is a genre no rule covered (spec §8.3) — `ToolbarOverflowMenu`
 * (DL §23) is one line, and DL-13.3's popover rows are §5 rows, also one line.
 */
export function CardActionsMenu(props: CardActionsMenuProps) {
  const placement = props.placement ?? "anchored";
  // The chord's anchor, read once at mount: the strip does not move while the
  // menu is up (any scroll closes it — `useDismiss`), and a card's `rect` is
  // the caller's to re-measure, so only the free-standing case reads the DOM.
  const [stripRect] = useState<AnchorRect | null>(() =>
    placement === "free-standing" ? stripAnchor() : null,
  );
  const { ref, style, placed } = useSurfacePlacement(
    placement === "free-standing" ? stripRect : props.rect,
    placement === "free-standing" ? "below" : "right",
  );
  useDismiss(props.onClose, ref, props.trigger);
  useStageOverlayFlag();
  const groups = actionGroups(props.actions, props.subject, placement);
  const where = subjectWhere(props.subject);

  // `role="menu"` PROMISES arrow-key movement, so the promise is kept — the
  // same block `ToolbarOverflowMenu` carries, for the same reason: focus lands
  // on the first row when the menu opens, arrows move it with wraparound, and
  // Home/End jump. Without it the `+` press would leave focus on the trigger
  // and the menu would be a mouse-only surface wearing a keyboard role.
  const rows = (): HTMLButtonElement[] => Array.from(ref.current?.querySelectorAll("button") ?? []);

  useEffect(() => {
    // Where focus was before the menu took it. Read at mount rather than from
    // `props.trigger`, which is null on the right-click path — the menu is
    // raised from the card there, and returning focus to whatever the user was
    // on is truer than picking an element for them.
    const returnTo = document.activeElement;
    return () => {
      // DL-13.2's own words ("on dismiss, focus returns to the pane or control
      // that had it"), unimplemented here until 2026-08-31: the focused row
      // simply unmounted, so focus fell to `<body>` and the next Tab restarted
      // from the top of the document instead of resuming at the `+`. Guarded
      // on still being connected — a menu whose whole card has gone (a project
      // closed under it) has nothing to return to, and focusing a detached
      // node is a no-op that would strand focus anyway.
      if (returnTo instanceof HTMLElement && returnTo.isConnected) {
        returnTo.focus();
      }
    };
  }, []);

  // The first row takes focus once the surface is PLACED, not at mount
  // (measured in the gallery, 2026-09-02): the surface is `visibility: hidden`
  // until `useSurfacePlacement` has read its box, and `focus()` on a hidden
  // element is a no-op — so the mount-time call left focus on the trigger, and
  // ⌘T's list opened with nothing focused for the hands that raised it. Once,
  // guarded by a ref: a re-render after the first placement must not steal
  // focus back to the first row.
  const focusedFirstRow = useRef(false);
  useEffect(() => {
    if (!placed || focusedFirstRow.current) {
      return;
    }
    focusedFirstRow.current = true;
    rows()[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      const all = rows();
      if (all.length === 0) {
        return;
      }
      event.preventDefault();
      const current = all.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? all.length - 1
            : event.key === "ArrowDown"
              ? (current + 1) % all.length
              : current <= 0
                ? all.length - 1
                : current - 1;
      all[next]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      class="asr-pop asr-pop--actions"
      role="menu"
      aria-label={`Actions for ${where}`}
      data-placement={placement}
      style={style}
    >
      {/* No heading on a CARD (owner, 2026-08-30). The head printed `Actions
          for <name>` over `Runs in <branch> [Primary|Worktree]` 6px from a card
          that states both, so the menu opened by repeating its own anchor. The
          scope still gets said once — in the footer — and the surface's
          `aria-label` above still names project, checkout and branch for a
          reader who cannot see the card. The `Primary`/`Worktree` word moved
          onto the card head's own badge (`checkoutBadge`).

          The FREE-STANDING placement has no card beside it, so the one thing
          the owner asked of every create control — "I must see which checkout
          the agent will run in" — has to be said here: ONE line, the composed
          destination (`whereOf`'s own words), not the two-line `Actions for` /
          `Runs in` head that came off (`rail-create-consolidation`, design D1;
          DL-27.25 amended). */}
      {placement === "free-standing" && <p class="asr-act__where">{where}</p>}
      {groups.map((rows, index) => (
        <Fragment key={rows[0]?.id ?? index}>
          {/* Not before the FIRST group: with the head gone, its separator
              would be a hairline across the menu's own top edge. */}
          {index > 0 && <div class="asr-pop__sep" />}
          {rows.map((row) => {
            if (row.kind === "note") {
              // Stated, not pressable, and not a `<button>` — the roving focus
              // above walks buttons, so an inert one would take an Arrow-key
              // stop and do nothing there. `role="none"` keeps it out of the
              // menu's item list while leaving the words readable.
              return (
                <p key={row.id} class="asr-act__note" role="none">
                  {row.text}
                </p>
              );
            }
            const glyph = row.glyph === undefined ? undefined : ACTION_GLYPHS[row.glyph];
            return (
              <button
                key={row.id}
                type="button"
                class="asr-act"
                role="menuitem"
                onClick={() => {
                  row.run();
                  props.onClose();
                }}
              >
                <span class="asr-act__glyph" aria-hidden="true">
                  {row.agent !== undefined ? (
                    <AgentGlyph agent={row.agent} className="asr-act__logo" />
                  ) : (
                    glyph !== undefined && <DeckIcon icon={glyph} size={CHROME_ICON} />
                  )}
                </span>
                <span class="asr-act__title">{row.title}</span>
                <span class="asr-act__detail">{row.detail}</span>
              </button>
            );
          })}
        </Fragment>
      ))}
      <div class="asr-pop__sep" />
      {props.subject.labelled && placement === "anchored" && (
        <>
          <WorktreeColorPicker path={props.subject.path} onClose={props.onClose} />
          <div class="asr-pop__sep" />
        </>
      )}
      <p class="asr-act__foot">
        <DeckIcon icon={Info} size={CHROME_ICON} />
        <span>
          {/* A folder git does not know is not a checkout, and the word would
              promise a branch the menu cannot offer. */}
          Everything here runs in this {props.subject.labelled ? "checkout" : "folder"}
        </span>
      </p>
    </div>
  );
}
