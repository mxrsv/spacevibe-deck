import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Fragment, type ComponentChildren } from "preact";
import {
  contrastRatio,
  deriveChromeColors,
  TEXT_FAINT_FLOOR,
  TEXT_MUTED_FLOOR,
  TEXT_PRIMARY_FLOOR,
} from "../../lib/derive-colors";
import { applyThemeVars } from "../../lib/theme-vars";
import { settings } from "../../settings/settings-store";
import { resolveTheme, THEME_PRESETS, type ThemePreset } from "../../settings/themes";
import { DesktopChrome } from "../../ui/desktop-chrome";
import { StatusBar } from "../../ui/status-bar";
import { SidebarToggle } from "../../ui/sidebar-toggle";
import { DockToggle } from "../../ui/dock/dock-toggle";
import { ConfigGroup, ConfigRow, ToggleRow } from "../../ui/controls/config-row";
import {
  agentRailNavigationSpecimen,
  deckToolbarSpecimen,
  NOOP,
  repositoryScopedTabStripSpecimen,
  tabBarSpecimen,
} from "../chrome-fixtures";
import { FORCE_CLASS, installForcedStates, type ForcedState } from "../force-states";
import { SectionHead } from "../specimen";
import { TreatmentDirectionReview } from "./treatment-direction-review";
/**
 * The comparison matrix the external review asked for (review §6 item 2): all
 * four themes, both tab-bar positions, five interaction states plus the
 * proposed inactive-window treatment, one size.
 *
 * BACK IN THE REGISTRY on 2026-08-13. It was parked while the direction was
 * nine fixed hex values — four theme columns would have been four copies of
 * one picture, and the section would have reported a pass on the exact
 * property it exists to test. The direction now derives every colour from
 * `--bg`/`--tone`, so the columns can finally differ, and this section is the
 * evidence for that rebuild
 * (docs/specs/2026-08-13-direction-token-rebuild-design.md §8).
 *
 * The point is that a wash cannot be judged on one theme. Tokyo Night's `--fg`
 * is a pale blue-violet, so a 4% `--fg` hover reads as "slightly lighter"
 * there and has to be checked against Dracula and One Dark before anyone calls
 * it neutral. Putting the four presets in one row at one size is the only way
 * to see that in a single glance instead of four screenshots taken minutes
 * apart.
 *
 * Every cell is the app's own `DesktopChrome`, `TabBar`, `AgentRail`,
 * `StatusBar` and config rows. The states come from two places and neither is
 * a hand-written copy of app CSS: `selected` and `disabled` are real props on
 * real components, and `hover` / `active` / `focus` are the app's own rules
 * re-scoped at runtime by `force-states.ts`.
 *
 * The one size is fixed rather than responsive: a matrix whose cells differ in
 * width would compare two things at once.
 */

/**
 * Every cell is this wide, in every block.
 *
 * Measured on both frames, not chosen by taste. Below the threshold the top
 * tab bar cannot fit four tabs beside the add button and six actions, so every
 * label clips — at 560px the four labels get 7, 9, 0 and 4 pixels. On this
 * branch's two-row chrome the labels come clear at 680px; on the collapsed
 * DL-18 command row it takes 760px, because that row also gives up
 * `--frame-lights-w` (78px) to the macOS traffic lights. Both were measured by
 * sweeping a live cell, and above each threshold nothing moves at all: the
 * labels sit at 37, 36, 20 and 19 from there to 900px.
 *
 * So the constant is the larger of the two. A matrix that compared a
 * degenerate tab bar would answer a question nobody asked, and one number that
 * is right on both frames beats a number that has to be edited during a merge.
 * Sidebar mode still leaves 560px of stage beside its 200px rail.
 *
 * Four of these do not fit a laptop viewport, which is why `.gx-matrix`
 * scrolls sideways rather than shrinking: cells of different widths would
 * compare two variables at once.
 */
const CELL_WIDTH = 760;

interface StateRow {
  readonly id: string;
  /** `null` where the state is a property of the DOM, not a pseudo-class. */
  readonly force: ForcedState | null;
  readonly disabled: boolean;
  readonly inactive: boolean;
  readonly note: string;
}

const STATE_ROWS: readonly StateRow[] = [
  {
    id: "hover",
    force: "hover",
    disabled: false,
    inactive: false,
    note: "every hoverable element at once, because a grid cannot hold a pointer",
  },
  {
    id: "active",
    force: "active",
    disabled: false,
    inactive: false,
    note: "pointer-down, the moment between hover and the click landing",
  },
  {
    id: "selected",
    force: null,
    disabled: false,
    inactive: false,
    note: "resting: the active tab, the selected workspace row, the on toggle",
  },
  {
    id: "inactive window",
    force: null,
    disabled: false,
    inactive: true,
    note: "draft: chrome recedes one rung while the terminal stage stays unchanged",
  },
  {
    id: "focus",
    force: "focus",
    disabled: false,
    inactive: false,
    note: "focus-visible and focus-within together (DL-6.4)",
  },
  {
    id: "disabled",
    force: null,
    disabled: true,
    inactive: false,
    note: "real disabled props on the real components, so the browser applies :disabled itself",
  },
];

/**
 * Said on the `disabled` row because the row cannot say it by rendering.
 *
 * This row used to report a gap: the pill was pixel-identical to an enabled
 * one, because `styles.css` declared nothing for `:disabled` or
 * `.cfg-btn--disabled`. The rule landed on 2026-08-14 (DL §10's closed list),
 * so the caption now names the treatment the row is showing rather than the
 * absence it used to show.
 */
const DISABLED_FINDING = "--text-faint, hover border and hint accent both off (DL-5.2, DL-21.4)";

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
  inactive,
  width = CELL_WIDTH,
  children,
}: {
  themeId: string;
  force: ForcedState | null;
  inactive: boolean;
  width?: number | string;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node !== null) {
      const theme = resolveTheme({
        ...settings.peek(),
        themeId,
        colorOverrides: {},
      });
      applyThemeVars(node.style, theme);
    }
  }, [themeId]);
  return (
    <div
      ref={ref}
      class={`gx-cell ${force === null ? "" : FORCE_CLASS[force]} ${inactive ? "gx-cell--inactive" : ""}`}
      style={{ width: typeof width === "number" ? `${width}px` : width }}
    >
      {children}
    </div>
  );
}

function WindowCell({
  sidebar,
  disabled,
  stageWitness = false,
}: {
  sidebar: boolean;
  disabled: boolean;
  stageWitness?: boolean;
}) {
  const stageWitnessBody = stageWitness ? (
    <div class="gx-native-terminal">
      <p>
        <span class="gx-native-terminal__prompt">❯</span> npm test
      </p>
      <p class="gx-native-terminal__result">✓ 2631 tests passed</p>
      <p class="gx-native-terminal__muted">terminal stage remains at full contrast</p>
    </div>
  ) : null;

  return (
    <DesktopChrome
      sidebar={sidebar}
      sidebarToggle={sidebar ? <SidebarToggle collapsed={false} onToggle={NOOP} /> : null}
      // The shipping frame row carries window controls only in sidebar mode;
      // its toolbar lives at the trailing end of the stage strip.
      toolbar={null}
      sidebarNavigation={
        sidebar ? agentRailNavigationSpecimen({ promptsDisabled: disabled }) : null
      }
      topTabs={sidebar ? null : tabBarSpecimen({ promptsDisabled: disabled })}
      stage={
        sidebar ? (
          <main class="stage stage--strip">
            <div class="stage__strip" data-tauri-drag-region>
              {repositoryScopedTabStripSpecimen()}
              <div class="stage__strip-actions">
                {deckToolbarSpecimen({ promptsDisabled: disabled })}
              </div>
              <DockToggle open={false} onToggle={NOOP} />
            </div>
            <div class="stage__tabs">{stageWitnessBody}</div>
          </main>
        ) : (
          <div class="stage">{stageWitnessBody}</div>
        )
      }
      status={<StatusBar />}
      onMacTitlebarDoubleClick={NOOP}
    />
  );
}

/**
 * The config-row vocabulary, which is where focus is legible and where the
 * window shell has almost nothing to show. It is also what proved that
 * disabled is NOT legible — see `DISABLED_FINDING`.
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
        <button type="button" class="cfg-btn cfg-btn--danger" disabled={disabled}>
          reset
        </button>
      </ConfigRow>
    </div>
  );
}

/**
 * What a row cannot show by rendering: that the state it names has no rule
 * behind it, so its cells are identical to the resting row. Read from the
 * built sheet rather than written here, because a hand-kept list would go on
 * claiming `:active` is missing the day somebody adds one.
 */
function rowFinding(row: StateRow, absent: readonly ForcedState[]): string | null {
  if (row.force !== null && absent.includes(row.force)) {
    return `identical to selected: styles.css declares no ${row.force === "focus" ? ":focus" : `:${row.force}`} rule`;
  }
  if (row.inactive) {
    return "gallery-only proposal: semantic accents fold to faint; chrome saturation drops; stage is untouched";
  }
  return row.disabled ? DISABLED_FINDING : null;
}

const NATIVE_WINDOW_PREVIEWS = [
  {
    id: "active",
    label: "Active window",
    note: "760px · full chrome contrast",
    width: 760,
    inactive: false,
  },
  {
    id: "inactive",
    label: "Inactive window",
    note: "760px · chrome recedes, stage holds",
    width: 760,
    inactive: true,
  },
  {
    id: "compact",
    label: "Compact window",
    note: "520px · 275px rail pressure stays visible",
    width: 520,
    inactive: false,
  },
] as const;

/**
 * Floors are imported, never restated. `deriveChromeColors` raises each tone to
 * these numbers itself since the Native balanced rollout, so this section only
 * measures the result and labels which bar it had to clear — and it labels it
 * with the very constant the derivation used. Writing 8 / 6 / 4.5 here would be
 * a second copy of DL-3.5 that could disagree with the shipping one.
 */
const TEXT_CONTRAST_ROLES = [
  {
    id: "primary",
    colorKey: "textPrimary",
    label: "Primary",
    token: "--text-primary",
    floor: TEXT_PRIMARY_FLOOR,
    sample: "Agent is ready",
    use: "names, values, active content",
  },
  {
    id: "muted",
    colorKey: "textMuted",
    label: "Muted",
    token: "--text-muted",
    floor: TEXT_MUTED_FLOOR,
    sample: "Resumed 2 min ago",
    use: "supporting values and metadata",
  },
  {
    id: "faint",
    colorKey: "textFaint",
    label: "Faint",
    token: "--text-faint",
    floor: TEXT_FAINT_FLOOR,
    sample: "Unbound · inactive",
    use: "hints, disabled and low-priority text",
  },
] as const;

const PALETTE_ROLES = [
  { id: "stage", label: "Stage", token: "--bg" },
  { id: "sidebar", label: "Sidebar", token: "--sidebar-bg" },
  { id: "chrome-1", label: "Chrome 1", token: "--chrome-1" },
  { id: "chrome-2", label: "Chrome 2", token: "--chrome-2" },
  { id: "accent", label: "Accent", token: "--accent" },
] as const;

/**
 * The selected direction, named but no longer measured here.
 *
 * The sizes used to sit in this object as four literals. They are now `:root`
 * variables in `src/styles.css` that the whole shipping chrome reads (DL-4.5),
 * so the specimen below aliases those variables instead and prints back what
 * the browser resolved. A number written in this file would be a second place
 * the scale could be edited, and the one place nobody would think to check.
 */
const NATIVE_BALANCED_TYPE_SCALE = {
  label: "Native balanced",
  note: "selected · compact without 9px text",
} as const;

/**
 * The shipping type tokens, in the order the specimen shows them. The card
 * aliases each `--gx-type-*` to its `--type-*` source, so the sample text is
 * painted by the shipping variable and the readout is the same value measured
 * back off the DOM.
 */
const TYPE_SCALE_TOKENS = ["--type-title", "--type-body", "--type-meta", "--type-micro"] as const;

const TYPE_SCALE_ALIAS = [
  "--gx-type-title:var(--type-title)",
  "--gx-type-body:var(--type-body)",
  "--gx-type-meta:var(--type-meta)",
  "--gx-type-micro:var(--type-micro)",
].join(";");

function contrastRows(preset: ThemePreset) {
  const chrome = deriveChromeColors(preset.theme.background, preset.theme.foreground);
  const commonSurfaces = [chrome.sidebarBg, chrome.chrome1, chrome.chrome2, chrome.tabActiveBg];

  return TEXT_CONTRAST_ROLES.map((role) => {
    const surfaces = role.id === "primary" ? [chrome.inputBg, ...commonSurfaces] : commonSurfaces;
    return {
      ...role,
      minimum: Math.min(
        ...surfaces.map((surface) => contrastRatio(chrome[role.colorKey], surface)),
      ),
    };
  });
}

function surfaceContrastRows(preset: ThemePreset) {
  const chrome = deriveChromeColors(preset.theme.background, preset.theme.foreground);
  const surfaces = [
    { id: "stage", label: "Stage", color: preset.theme.background },
    { id: "sidebar", label: "Sidebar", color: chrome.sidebarBg },
    { id: "chrome-1", label: "Chrome 1", color: chrome.chrome1 },
    { id: "chrome-2", label: "Chrome 2", color: chrome.chrome2 },
    { id: "selected", label: "Selected", color: chrome.tabActiveBg },
    { id: "input", label: "Input", color: chrome.inputBg },
  ] as const;

  return {
    surfaces,
    roles: TEXT_CONTRAST_ROLES.map((role) => ({
      ...role,
      cells: surfaces.map((surface) => ({
        ...surface,
        ratio: contrastRatio(chrome[role.colorKey], surface.color),
      })),
    })),
  };
}

/** Quantitative color evidence beside the rendered samples. */
function ContrastReview() {
  return (
    <section class="gx-specimen">
      <header class="gx-specimen__head">
        <span class="gx-specimen__name">text contrast ladder</span>
        <span class="gx-specimen__note">
          minimum ratio across the real sidebar, chrome, selected and input surfaces · 4 themes ·
          live derived tokens
        </span>
      </header>
      <div class="gx-contrast-grid">
        {THEME_PRESETS.map((preset) => (
          <ThemeCell key={preset.id} themeId={preset.id} force={null} inactive={false} width={270}>
            <article class="gx-contrast-card">
              <header class="gx-contrast-card__head">
                <strong>{preset.label}</strong>
                <span>{preset.id}</span>
              </header>
              <div
                class="gx-contrast-card__palette"
                aria-label={`${preset.label} surface and accent palette`}
              >
                {PALETTE_ROLES.map((role) => (
                  <span
                    key={role.id}
                    class={`gx-contrast-card__swatch gx-contrast-card__swatch--${role.id}`}
                    title={`${role.label} · ${role.token}`}
                  />
                ))}
              </div>
              {contrastRows(preset).map((role) => (
                <div key={role.id} class="gx-contrast-row">
                  <div>
                    <span class={`gx-contrast-row__sample gx-contrast-row__sample--${role.id}`}>
                      {role.sample}
                    </span>
                    <span class="gx-contrast-row__use">{role.use}</span>
                  </div>
                  <span class="gx-contrast-row__ratio">
                    {role.minimum.toFixed(2)}:1
                    <small>floor {role.floor}:1</small>
                  </span>
                </div>
              ))}
            </article>
          </ThemeCell>
        ))}
      </div>
    </section>
  );
}

/** Every valid and invalid text/surface pairing, rather than only the minimum. */
function SurfaceContrastReview() {
  return (
    <section class="gx-specimen">
      <header class="gx-specimen__head">
        <span class="gx-specimen__name">text-to-surface contrast</span>
        <span class="gx-specimen__note">
          each number is measured independently · green meets that text role's floor · amber exposes
          a pairing that must not be used
        </span>
      </header>
      <div class="gx-surface-matrix-grid">
        {THEME_PRESETS.map((preset) => {
          const matrix = surfaceContrastRows(preset);
          return (
            <ThemeCell
              key={preset.id}
              themeId={preset.id}
              force={null}
              inactive={false}
              width="100%"
            >
              <article class="gx-surface-matrix">
                <header class="gx-surface-matrix__head">
                  <strong>{preset.label}</strong>
                  <span>contrast ratio : 1</span>
                </header>
                <div class="gx-surface-matrix__table">
                  <span />
                  {matrix.surfaces.map((surface) => (
                    <span key={surface.id} class="gx-surface-matrix__surface">
                      <i class={`gx-surface-matrix__dot gx-surface-matrix__dot--${surface.id}`} />
                      {surface.label}
                    </span>
                  ))}
                  {matrix.roles.map((role) => (
                    <Fragment key={role.id}>
                      <span
                        class={`gx-surface-matrix__role gx-surface-matrix__role--${role.id}`}
                        title={`${role.token} · floor ${role.floor}:1`}
                      >
                        {role.label}
                        <small>≥ {role.floor}</small>
                      </span>
                      {role.cells.map((cell) => (
                        <span
                          key={`${role.id}-${cell.id}`}
                          class={`gx-surface-matrix__ratio ${cell.ratio >= role.floor ? "is-safe" : "is-unsafe"}`}
                          title={`${role.token} on ${cell.label}: ${cell.ratio.toFixed(2)}:1`}
                        >
                          {cell.ratio.toFixed(2)}
                        </span>
                      ))}
                    </Fragment>
                  ))}
                </div>
              </article>
            </ThemeCell>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The shipped type scale, rendered by the shipped variables.
 *
 * The card no longer carries the four numbers: `--gx-type-*` alias `--type-*`,
 * so the sample text is sized by the same declarations the app's chrome reads,
 * and the readout is those values measured back off the card after layout.
 * Change `styles.css` and this specimen follows without an edit here — which is
 * the property the section exists to demonstrate.
 */
function TypeScaleReview() {
  const scale = NATIVE_BALANCED_TYPE_SCALE;
  const ref = useRef<HTMLElement | null>(null);
  const [sizes, setSizes] = useState<readonly string[]>([]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const style = getComputedStyle(node);
    setSizes(
      TYPE_SCALE_TOKENS.map((token) => style.getPropertyValue(token).trim()).filter(
        (value) => value !== "",
      ),
    );
  }, []);
  return (
    <section class="gx-specimen">
      <header class="gx-specimen__head">
        <span class="gx-specimen__name">type hierarchy</span>
        <span class="gx-specimen__note">
          Native balanced · selected gallery theme · sized by the shipping --type-* variables
        </span>
      </header>
      <div class="gx-type-grid">
        <article ref={ref} class="gx-type-card" style={TYPE_SCALE_ALIAS}>
          <header class="gx-type-card__head">
            <strong>{scale.label}</strong>
            <span>{scale.note}</span>
          </header>
          <div class="gx-type-card__sample">
            <strong class="gx-type-card__title">Workspace settings</strong>
            <span class="gx-type-card__body">Restore tabs and agent sessions when Deck opens.</span>
            <span class="gx-type-card__meta">Resumed 2 min ago</span>
            <span class="gx-type-card__micro">⌘⇧B · Toggle explorer</span>
          </div>
          {/* Empty until the layout effect has run, and empty for good if
              `styles.css` ever stops declaring the tokens — which is a finding
              worth seeing, not a gap worth filling with a written-down number. */}
          <footer>{sizes.length === 0 ? "--type-* not resolved" : sizes.join(" / ")}</footer>
        </article>
      </div>
    </section>
  );
}

/**
 * The fast eye-review surface. The exhaustive matrix below proves themes and
 * pseudo-states; this strip puts the three native-window decisions beside one
 * another at a useful viewing size so the reviewer does not have to infer the
 * direction from a 24-cell audit table.
 */
function NativeWindowReview() {
  return (
    <section class="gx-specimen">
      <header class="gx-specimen__head">
        <span class="gx-specimen__name">native window treatment</span>
        <span class="gx-specimen__note">
          real Deck chrome · selected gallery theme · inactive is a proposal, not shipping policy
        </span>
      </header>
      <div class="gx-native-detail-strip">
        {NATIVE_WINDOW_PREVIEWS.map((preview) => (
          <article
            key={preview.id}
            class={`gx-native-detail ${preview.inactive ? "gx-cell--inactive" : ""}`}
            style={{ width: `${preview.width}px` }}
          >
            <header class="gx-native-detail__head">
              <strong>{preview.label}</strong>
              <span>{preview.note}</span>
            </header>
            <div class="gx-native-detail__window">
              <WindowCell sidebar disabled={false} stageWitness />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MatrixBlock({
  title,
  note,
  tall,
  absent,
  render,
}: {
  title: string;
  note: string;
  tall: boolean;
  absent: readonly ForcedState[];
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
            <span key={preset.id} class="gx-matrix__colhead" style={{ width: `${CELL_WIDTH}px` }}>
              {preset.id}
            </span>
          ))}
        </div>
        {STATE_ROWS.map((row) => (
          <div key={row.id} class="gx-matrix__row">
            <span class="gx-matrix__rowhead">
              <span class="gx-matrix__statename">{row.id}</span>
              <span class="gx-matrix__statenote">{row.note}</span>
              {rowFinding(row, absent) !== null && (
                <span class="gx-matrix__finding">{rowFinding(row, absent)}</span>
              )}
            </span>
            {THEME_PRESETS.map((preset) => (
              <ThemeCell
                key={preset.id}
                themeId={preset.id}
                force={row.force}
                inactive={row.inactive}
              >
                <div class={`gx-cell__inner ${tall ? "gx-cell__inner--tall" : ""}`}>
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
  const [absent, setAbsent] = useState<readonly ForcedState[]>([]);

  // Rebuilt on mount so an HMR edit to styles.css reaches the forced copies:
  // leave the section and come back.
  useLayoutEffect(() => {
    const installed = installForcedStates();
    setAbsent(installed.absent);
    return installed.dispose;
  }, []);

  return (
    <>
      <SectionHead
        title="Native detail matrix"
        blurb="Pick one canonical treatment first; then validate its type, contrast and states across every built-in theme. Themes remain color skins, never separate designs."
      />

      {/* No contrast scope around these two any more. The 8 / 6 / 4.5 floors
          this section proposed now live inside `deriveChromeColors`, so the
          specimens below inherit them from the theme itself and a gallery-only
          override would only be able to disagree with what ships. */}
      <TreatmentDirectionReview
        renderWindow={() => <WindowCell sidebar disabled={false} stageWitness />}
      />
      <TypeScaleReview />
      <ContrastReview />
      <SurfaceContrastReview />
      <NativeWindowReview />

      <MatrixBlock
        title="window chrome — tabBarPosition: top"
        note="real DesktopChrome; hover, active and focus are the app's own rules re-scoped, not copies"
        tall
        absent={absent}
        render={(disabled) => <WindowCell sidebar={false} disabled={disabled} />}
      />

      <MatrixBlock
        title="window chrome — tabBarPosition: left"
        note="the same shell in sidebar mode, carrying AgentRail's project → tab and agent navigation"
        tall
        absent={absent}
        render={(disabled) => <WindowCell sidebar disabled={disabled} />}
      />

      <MatrixBlock
        title="config rows"
        note="where focus is legible and disabled measurably is not; independent of tab-bar position"
        tall={false}
        absent={absent}
        render={(disabled) => <ControlCell disabled={disabled} />}
      />
    </>
  );
}
