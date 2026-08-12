import { useSignal } from "@preact/signals";
import { PanelLeft, PanelRight } from "lucide-preact";
import { AgentAttentionMark } from "../../ui/agent-attention-mark";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import { tildify } from "../../lib/process-info";
import {
  SEED_WORKBENCH,
  type WorkbenchFixture,
  type WorkbenchWorkspace,
} from "../seed-data";

/**
 * Round one of docs/specs/2026-08-12-agent-workbench-gallery-design.md: three
 * compositions of the same agent workbench, judged against each other.
 *
 * There is no window-wide titlebar. Each of the three regions owns its own
 * header row at the same height, so the hairlines line up across the window
 * and every region is bounded by itself rather than by a bar that spans all of
 * them. That is what makes the sidebar collapsible without leaving a stub
 * behind: the window controls travel into whichever region is leftmost.
 *
 * The markup is gallery-owned on purpose. Round one asks one question — where
 * do navigation, terminal and files sit relative to each other — and answering
 * it with the shipping shell would mean changing the shipping shell three ways
 * to ask it. Treatment, and the real components that survive the comparison,
 * belong to round two. `AgentAttentionMark` is the one exception: attention is
 * the state the Attention rail candidate exists to argue about, it is a pure
 * component with no IPC, and a hand-drawn stand-in would be arguing about the
 * stand-in.
 *
 * Colours, type and hairlines inside the specimen come from the app's theme
 * tokens, not from the harness's fixed hexes — the compositions have to hold up
 * under every theme the gallery can switch to. Mono appears in exactly one
 * place, terminal output, which is what DL-4.1 reserves it for.
 */

export type WorkbenchVariant = "balanced" | "rail" | "stage";

interface VariantSpec {
  /** The candidate's name in the spec. */
  readonly label: string;
  /** How much of a workspace the left region spells out. */
  readonly navDetail: "name" | "agent" | "full";
  /**
   * `split` gives one pane the room and stacks the other two beside it;
   * `columns` gives all three equal width, which is what "biased toward
   * supervision" means when the thing being supervised is three agents.
   */
  readonly paneLayout: "split" | "columns";
}

export const WORKBENCH_VARIANTS: Readonly<
  Record<WorkbenchVariant, VariantSpec>
> = {
  balanced: {
    label: "Balanced dock",
    navDetail: "agent",
    paneLayout: "split",
  },
  rail: { label: "Attention rail", navDetail: "full", paneLayout: "columns" },
  stage: { label: "Stage first", navDetail: "name", paneLayout: "split" },
};

const NOOP = (): void => {};

/** `M` / `A` — the two-letter porcelain the status bar and `git` already use. */
const CHANGE_MARK: Readonly<Record<string, string>> = {
  modified: "M",
  added: "A",
};

/**
 * The OS window buttons, in the three colours macOS gives them.
 *
 * Outside DL-3.2 by the same reasoning DL-14.6 puts logos and key legends
 * outside the icon system: these are the operating system's controls quoted
 * into a mock, not Deck spending `--red` on danger. They exist here only so the
 * compositions are judged with the space the OS actually takes.
 */
function WindowControls() {
  return (
    <span class="gx-workbench__oscontrols" aria-hidden="true">
      <span class="gx-workbench__osdot gx-workbench__osdot--close" />
      <span class="gx-workbench__osdot gx-workbench__osdot--min" />
      <span class="gx-workbench__osdot gx-workbench__osdot--zoom" />
    </span>
  );
}

/** What each collapsible region is called, in the words its tooltip uses. */
const PANEL_NAME: Readonly<Record<"nav" | "dock", string>> = {
  nav: "sidebar",
  dock: "explorer",
};

const PANEL_ICON = { nav: PanelLeft, dock: PanelRight } as const;

/**
 * Both side regions collapse, and both toggles live on the edge that touches
 * the stage — the left region's at the end of its header, the right region's
 * at the start of its own. When a region leaves, its toggle moves to the stage
 * header's matching edge, so the control never travels across the window and
 * the direction it points still means the same thing.
 */
function PanelToggle({
  panel,
  open,
  controls,
  onToggle,
}: {
  panel: "nav" | "dock";
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const label = `${open ? "Hide" : "Show"} ${PANEL_NAME[panel]}`;
  return (
    <button
      type="button"
      class={`gx-workbench__paneltoggle gx-workbench__paneltoggle--${panel}`}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <DeckIcon icon={PANEL_ICON[panel]} size={CHROME_ICON} />
    </button>
  );
}

function WorkspaceRow({
  workspace,
  detail,
}: {
  workspace: WorkbenchWorkspace;
  detail: VariantSpec["navDetail"];
}) {
  return (
    <li
      class={`gx-workbench__ws ${workspace.selected ? "is-selected" : ""}`}
      aria-current={workspace.selected}
    >
      <span class="gx-workbench__wsname">{workspace.name}</span>
      <span class="gx-workbench__wsmark">
        <AgentAttentionMark
          summary={workspace.attention}
          label={workspace.name}
          onActivate={NOOP}
        />
      </span>
      {detail !== "name" && (
        <span class="gx-workbench__wsmeta">
          {detail === "full"
            ? `${workspace.agent} · ${workspace.branch}`
            : workspace.agent}
        </span>
      )}
    </li>
  );
}

interface WorkbenchSpecimenProps {
  variant: WorkbenchVariant;
  /** The narrow desktop width, where side regions have to give ground. */
  compact?: boolean;
  fixture?: WorkbenchFixture;
}

export function WorkbenchSpecimen({
  variant,
  compact = false,
  fixture = SEED_WORKBENCH,
}: WorkbenchSpecimenProps) {
  const navOpen = useSignal(true);
  const dockOpen = useSignal(true);
  const spec = WORKBENCH_VARIANTS[variant];
  /*
   * Compact drops the branch rather than the whole meta line: the Attention
   * rail candidate exists to argue that the hierarchy is worth its width, and
   * collapsing it to a bare name at the narrow width would be answering that
   * argument in CSS instead of showing it to the owner.
   */
  const detail =
    compact && spec.navDetail === "full" ? "agent" : spec.navDetail;
  const { project, workspaces, surfaces, panes, explorer, status } = fixture;
  const cwd = status.cwd === null ? null : tildify(status.cwd, status.home);
  const idBase = `gx-workbench-${variant}-${compact ? "compact" : "wide"}`;
  const navId = `${idBase}-nav`;
  const dockId = `${idBase}-dock`;
  const showNav = navOpen.value;
  const showDock = dockOpen.value;

  const leadingControls = (
    <>
      <WindowControls />
      <PanelToggle
        panel="nav"
        open={showNav}
        controls={navId}
        onToggle={() => {
          navOpen.value = !showNav;
        }}
      />
    </>
  );

  const dockToggle = (
    <PanelToggle
      panel="dock"
      open={showDock}
      controls={dockId}
      onToggle={() => {
        dockOpen.value = !showDock;
      }}
    />
  );

  return (
    <div
      class={`gx-workbench-frame ${compact ? "gx-workbench-frame--compact" : ""}`}
    >
      <div
        class={`gx-workbench gx-workbench--${variant} ${compact ? "is-compact" : ""} ${showNav ? "" : "is-navhidden"} ${showDock ? "" : "is-dockhidden"}`}
        role="group"
        aria-label={`${spec.label}, ${compact ? "compact" : "wide"} width`}
      >
        <div class="gx-workbench__body">
          {showNav && (
            <div
              id={navId}
              class="gx-workbench__nav"
              role="group"
              aria-label="Workspaces"
            >
              <div class="gx-workbench__head gx-workbench__head--nav">
                {leadingControls}
              </div>
              <ul class="gx-workbench__wslist">
                {workspaces.map((workspace) => (
                  <WorkspaceRow
                    key={workspace.id}
                    workspace={workspace}
                    detail={detail}
                  />
                ))}
              </ul>
            </div>
          )}

          <div
            class="gx-workbench__stage"
            role="group"
            aria-label="Terminal stage"
          >
            <div class="gx-workbench__head gx-workbench__head--stage">
              {!showNav && leadingControls}
              <ul class="gx-workbench__surfacelist">
                {surfaces.map((surface) => (
                  <li
                    key={surface.id}
                    class={`gx-workbench__surface ${surface.selected ? "is-selected" : ""} ${surface.future ? "is-future" : ""}`}
                    aria-current={surface.selected}
                  >
                    <span class="gx-workbench__surfacelabel">
                      {surface.label}
                    </span>
                    {surface.future && (
                      <span class="gx-workbench__surfacenote">not built</span>
                    )}
                  </li>
                ))}
              </ul>
              {!showDock && dockToggle}
            </div>

            <div
              class={`gx-workbench__panes gx-workbench__panes--${spec.paneLayout}`}
            >
              {panes.map((pane) => (
                <div
                  key={pane.id}
                  class={`gx-workbench__pane ${pane.focused ? "is-focused" : ""}`}
                  role="group"
                  aria-label={pane.title}
                >
                  <pre class="gx-workbench__paneout">
                    {pane.lines.join("\n")}
                  </pre>
                </div>
              ))}
            </div>
          </div>

          {showDock && (
            <div
              id={dockId}
              class="gx-workbench__dock"
              role="group"
              aria-label="Explorer"
            >
              <div class="gx-workbench__head gx-workbench__head--dock">
                {dockToggle}
                <span class="gx-workbench__docktitle">explorer</span>
                <span class="gx-workbench__dockroot">{explorer.root}</span>
              </div>
              <ul class="gx-workbench__tree">
                {explorer.entries.map((entry) => (
                  <li
                    key={entry.id}
                    class={`gx-workbench__row gx-workbench__row--${entry.kind} ${entry.selected ? "is-selected" : ""}`}
                    style={`--gx-workbench-depth:${entry.depth}`}
                    aria-current={entry.selected}
                  >
                    <span class="gx-workbench__rowname">{entry.name}</span>
                    {entry.change !== "none" && (
                      <span
                        class={`gx-workbench__change gx-workbench__change--${entry.change}`}
                        title={entry.change}
                      >
                        {CHANGE_MARK[entry.change]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div class="gx-workbench__status">
          <span class="gx-workbench__statusitem" title={project.path}>
            {project.name}
          </span>
          <span class="gx-workbench__statusitem">{status.branch}</span>
          {cwd !== null && <span class="gx-workbench__statusitem">{cwd}</span>}
          <span class="gx-workbench__statusitem">{status.agent}</span>
        </div>
      </div>
    </div>
  );
}
