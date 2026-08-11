import { useLayoutEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { applyThemeVars } from "../../lib/theme-vars";
import { settings } from "../../settings/settings-store";
import { resolveTheme, THEME_PRESETS } from "../../settings/themes";
import { ChromeActions } from "../../ui/chrome-actions";
import { DesktopChrome } from "../../ui/app";
import { StatusBar } from "../../ui/status-bar";
import { TabBar } from "../../ui/tab-bar";
import { WorkspaceSidebar } from "../../ui/workspace-sidebar";
import {
  ConfigGroup,
  ConfigRow,
  ToggleRow,
} from "../../ui/controls/config-row";
import {
  FORCE_CLASS,
  installForcedStates,
  type ForcedState,
} from "../force-states";
import { SectionHead } from "../specimen";

/**
 * The comparison matrix the external review asked for (§6 item 2): all four
 * themes, both tab-bar positions, five interaction states, one size.
 *
 * The point is that a wash cannot be judged on one theme. Tokyo Night's `--fg`
 * is a pale blue-violet, so a 4% `--fg` hover reads as "slightly lighter"
 * there and has to be checked against Dracula and One Dark before anyone calls
 * it neutral. Putting the four presets in one row at one size is the only way
 * to see that in a single glance instead of four screenshots taken minutes
 * apart.
 *
 * Every cell is the app's own `DesktopChrome`, `TabBar`, `WorkspaceSidebar`,
 * `StatusBar` and config rows. The states come from two places and neither is
 * a hand-written copy of app CSS: `selected` and `disabled` are real props on
 * real components, and `hover` / `active` / `focus` are the app's own rules
 * re-scoped at runtime by `force-states.ts`.
 *
 * The one size is fixed rather than responsive: a matrix whose cells differ in
 * width would compare two things at once.
 */

const NOOP = (): void => {};

/**
 * Every cell is this wide, in every block.
 *
 * Measured, not chosen by taste. Below 680px the top tab bar cannot fit four
 * tabs beside the add button and six actions, so every label clips — at 560px
 * the four labels get 7, 9, 0 and 4 pixels. 680 is the exact width at which
 * clipping stops, and widening further changes nothing: from 680 to 900 the
 * labels stay at 37, 36, 20 and 19. A matrix that compared a degenerate tab
 * bar would answer a question nobody asked. Sidebar mode still leaves 480px of
 * stage beside its 200px rail.
 *
 * Four of these do not fit a laptop viewport, which is why `.gx-matrix`
 * scrolls sideways rather than shrinking: cells of different widths would
 * compare two variables at once.
 */
const CELL_WIDTH = 680;

interface StateRow {
  readonly id: string;
  /** `null` where the state is a property of the DOM, not a pseudo-class. */
  readonly force: ForcedState | null;
  readonly disabled: boolean;
  readonly note: string;
}

const STATE_ROWS: readonly StateRow[] = [
  {
    id: "hover",
    force: "hover",
    disabled: false,
    note: "every hoverable element at once, because a grid cannot hold a pointer",
  },
  {
    id: "active",
    force: "active",
    disabled: false,
    note: "pointer-down; compare it with the row below — almost nothing separates them today",
  },
  {
    id: "selected",
    force: null,
    disabled: false,
    note: "resting: the active tab, the selected workspace row, the on toggle",
  },
  {
    id: "focus",
    force: "focus",
    disabled: false,
    note: "focus-visible and focus-within together (DL-6.4)",
  },
  {
    id: "disabled",
    force: null,
    disabled: true,
    note: "real disabled props, so the browser applies :disabled itself",
  },
];

/**
 * A theme scope. `applyThemeVars` takes a `CSSStyleDeclaration`, so pointing it
 * at an element's inline style publishes one theme to that subtree only — which
 * is what lets four themes coexist on one page without four windows.
 *
 * `peek()` rather than `.value`: the matrix pins the four presets deliberately
 * and must not follow the gallery's theme picker, or every column would show
 * the same theme.
 */
function ThemeCell({
  themeId,
  force,
  children,
}: {
  themeId: string;
  force: ForcedState | null;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node !== null) {
      applyThemeVars(
        node.style,
        resolveTheme({ ...settings.peek(), themeId, colorOverrides: {} }),
      );
    }
  }, [themeId]);
  return (
    <div
      ref={ref}
      class={`gx-cell ${force === null ? "" : FORCE_CLASS[force]}`}
      style={{ width: `${CELL_WIDTH}px` }}
    >
      {children}
    </div>
  );
}

function chromeActions(disabled: boolean) {
  return (
    <ChromeActions
      settingsOpen={false}
      expandActive={false}
      promptsOpen={false}
      promptsDisabled={disabled}
      onSplitRow={NOOP}
      onSplitColumn={NOOP}
      onClosePane={NOOP}
      onToggleExpand={NOOP}
      onTogglePrompts={NOOP}
      onToggleSettings={NOOP}
    />
  );
}

function WindowCell({
  sidebar,
  disabled,
}: {
  sidebar: boolean;
  disabled: boolean;
}) {
  return (
    <DesktopChrome
      sidebar={sidebar}
      // In sidebar mode the actions live in the titlebar; in top mode `TabBar`
      // renders them itself. Passing the real component either way is what
      // gives the disabled row something to show in both positions.
      toolbar={sidebar ? chromeActions(disabled) : null}
      sidebarNavigation={
        sidebar ? (
          <WorkspaceSidebar
            onSelectTab={NOOP}
            onCloseTab={NOOP}
            onNewTab={NOOP}
            onRenameTab={NOOP}
            onSetTabColor={NOOP}
            onFocusAttention={NOOP}
          />
        ) : null
      }
      topTabs={
        sidebar ? null : (
          <TabBar
            settingsOpen={false}
            expandActive={false}
            promptsOpen={false}
            promptsDisabled={disabled}
            onSelectTab={NOOP}
            onCloseTab={NOOP}
            onNewTab={NOOP}
            onSplitRow={NOOP}
            onSplitColumn={NOOP}
            onClosePane={NOOP}
            onRenameTab={NOOP}
            onSetTabColor={NOOP}
            onToggleSettings={NOOP}
            onTogglePrompts={NOOP}
            onToggleExpand={NOOP}
            onFocusAttention={NOOP}
          />
        )
      }
      stage={<div class="stage" />}
      status={<StatusBar />}
      onMacTitlebarDoubleClick={NOOP}
    />
  );
}

/**
 * The config-row vocabulary, which is where focus and disabled are legible and
 * where the window shell has almost nothing to show.
 *
 * `ToggleRow` is the real component. The two pills below it are hand-assembled
 * because no exported component produces a bare `cfg-btn` — the same
 * compromise `rows-section.tsx` already makes for `danger`, and the reason the
 * real settings sections are mounted there rather than here.
 */
function ControlCell({ disabled }: { disabled: boolean }) {
  return (
    <div class="settings-screen__section">
      <ConfigGroup label="appearance" />
      <ToggleRow
        label="Show pane bar"
        desc="per-pane title row"
        checked
        onToggle={NOOP}
        disabled={disabled}
      />
      <ConfigRow label="Theme" desc="terminal colours">
        <button type="button" class="cfg-btn" disabled={disabled}>
          tokyo-night
        </button>
      </ConfigRow>
      <ConfigRow label="Restore defaults" danger>
        <button
          type="button"
          class="cfg-btn cfg-btn--danger"
          disabled={disabled}
        >
          reset
        </button>
      </ConfigRow>
    </div>
  );
}

function MatrixBlock({
  title,
  note,
  tall,
  render,
}: {
  title: string;
  note: string;
  tall: boolean;
  render: (disabled: boolean) => ComponentChildren;
}) {
  return (
    <section class="gx-specimen">
      <header class="gx-specimen__head">
        <span class="gx-specimen__name">{title}</span>
        <span class="gx-specimen__note">{note}</span>
      </header>
      <div class="gx-matrix">
        <div class="gx-matrix__row">
          <span class="gx-matrix__rowhead" />
          {THEME_PRESETS.map((preset) => (
            <span
              key={preset.id}
              class="gx-matrix__colhead"
              style={{ width: `${CELL_WIDTH}px` }}
            >
              {preset.id}
            </span>
          ))}
        </div>
        {STATE_ROWS.map((row) => (
          <div key={row.id} class="gx-matrix__row">
            <span class="gx-matrix__rowhead">
              <span class="gx-matrix__statename">{row.id}</span>
              <span class="gx-matrix__statenote">{row.note}</span>
            </span>
            {THEME_PRESETS.map((preset) => (
              <ThemeCell key={preset.id} themeId={preset.id} force={row.force}>
                <div
                  class={`gx-cell__inner ${tall ? "gx-cell__inner--tall" : ""}`}
                >
                  {render(row.disabled)}
                </div>
              </ThemeCell>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function MatrixSection() {
  // Rebuilt on mount so an HMR edit to styles.css reaches the forced copies:
  // leave the section and come back.
  useLayoutEffect(() => installForcedStates(), []);

  return (
    <>
      <SectionHead
        title="State matrix"
        blurb="Four themes across, five states down, one size — the comparison the external review asked for before any wash is called neutral."
      />

      <MatrixBlock
        title="window chrome — tabBarPosition: top"
        note="real DesktopChrome; hover, active and focus are the app's own rules re-scoped, not copies"
        tall
        render={(disabled) => (
          <WindowCell sidebar={false} disabled={disabled} />
        )}
      />

      <MatrixBlock
        title="window chrome — tabBarPosition: left"
        note="the same shell in sidebar mode; the chrome actions move into the titlebar"
        tall
        render={(disabled) => <WindowCell sidebar disabled={disabled} />}
      />

      <MatrixBlock
        title="config rows"
        note="where focus and disabled are legible; independent of tab-bar position"
        tall={false}
        render={(disabled) => <ControlCell disabled={disabled} />}
      />
    </>
  );
}
