import {
  ChevronDown,
  File,
  FolderOpen,
  MoreHorizontal,
  X,
} from "lucide-preact";
import { PresetThumb } from "../../presets/preset-thumb";
import { AgentAttentionMark } from "../../ui/agent-attention-mark";
import { DesktopChrome } from "../../ui/app";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import { WorkspaceSpinner } from "../../ui/workspace-spinner";
import { UpdateAction } from "../../updater/update-action";
import type { UpdatePhase } from "../../updater/update-controller";
import {
  chatGptToolbarSpecimen,
  NOOP,
  repositorySidebarSpecimen,
} from "../chrome-fixtures";
import { SEED_ATTENTION, SEED_LAYOUT } from "../seed-data";
import { SectionHead, Specimen, StateLabel } from "../specimen";

/** Every phase the update pill can be in, `hidden` excluded — it renders nothing. */
const UPDATE_PHASES: readonly Exclude<UpdatePhase, "hidden">[] = [
  "available",
  "downloading",
  "downloaded",
  "download-failed",
  "installing",
  "install-failed",
  "relaunch-failed",
];

const EXPLORER_ROWS = [
  { label: "src", kind: "folder", depth: 0 },
  { label: "gallery", kind: "folder", depth: 1 },
  { label: "chrome-section.tsx", kind: "file", depth: 2, selected: true },
  { label: "chatgpt-direction.css", kind: "file", depth: 2 },
  { label: "terminal", kind: "folder", depth: 1 },
  { label: "app.tsx", kind: "file", depth: 1 },
  { label: "package.json", kind: "file", depth: 0 },
] as const;

/**
 * The sessions open in the selected worktree. A Deck tab holds a whole pane
 * layout, so the two panes below belong to `claude` — the other two are
 * suspended shells, and the dot is the only thing that says so.
 */
const TERMINAL_TABS = [
  { label: "claude", activity: "running", selected: true },
  { label: "codex", activity: "idle" },
  { label: "shell", activity: "idle" },
] as const;

/**
 * The window shell in both layouts, assembled by the app's own
 * `DesktopChrome` — so the grid, the hairlines and the bar heights here are
 * the shipped ones, not a reconstruction.
 *
 * Tab hover, tab selection and the options popover are all live: clicking the
 * active tab opens the real `TabPopover` through `TabBar`'s own state.
 */

function ChatGptTerminalStage() {
  return (
    <div class="stage gx-chatgpt-workspace" aria-label="Workspace preview">
      <main class="gx-chatgpt-terminal" aria-label="Terminal workspace preview">
        <div
          class="gx-chatgpt-terminal__tabs"
          role="tablist"
          aria-label="Terminal sessions"
        >
          {TERMINAL_TABS.map((tab) => {
            const selected = "selected" in tab && tab.selected;
            return (
              <div
                key={tab.label}
                class={`gx-chatgpt-terminal__tab ${selected ? "is-active" : ""}`}
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
              >
                <span
                  class={`gx-chatgpt-terminal__dot is-${tab.activity}`}
                  aria-hidden="true"
                />
                <span class="gx-chatgpt-terminal__tablabel">{tab.label}</span>
                <button
                  type="button"
                  class="gx-chatgpt-terminal__close"
                  aria-label={`Close ${tab.label}`}
                  onClick={NOOP}
                >
                  <DeckIcon icon={X} size={CHROME_ICON} />
                </button>
              </div>
            );
          })}
          <div class="gx-chatgpt-terminal__tabfill">
            <button
              type="button"
              class="gx-chatgpt-terminal__branch"
              aria-label="Switch branch"
              onClick={NOOP}
            >
              <span>electron-migration</span>
              <DeckIcon icon={ChevronDown} size={CHROME_ICON} />
            </button>
          </div>
        </div>
        <div class="gx-chatgpt-terminal__grid">
          <section class="gx-chatgpt-pane gx-chatgpt-pane--primary">
            <div class="gx-chatgpt-pane__body">
              <p>
                <span class="gx-chatgpt-pane__prompt">❯</span> npm run test
              </p>
              <p class="gx-chatgpt-pane__muted">RUN v3.2.4 /spacevibe-deck</p>
              <p>
                <span class="gx-chatgpt-pane__success">✓</span> 41 files passed
              </p>
              <p>
                <span class="gx-chatgpt-pane__success">✓</span> 312 tests passed
              </p>
              <p class="gx-chatgpt-pane__cursor">
                <span class="gx-chatgpt-pane__prompt">❯</span> review the chrome
                redesign
              </p>
            </div>
          </section>
          <section class="gx-chatgpt-pane">
            <div class="gx-chatgpt-pane__body">
              <p>
                <span class="gx-chatgpt-pane__prompt">❯</span> git diff --stat
              </p>
              <p class="gx-chatgpt-pane__muted">src/gallery/gallery.css</p>
              <p class="gx-chatgpt-pane__muted">
                src/gallery/sections/chrome-section.tsx
              </p>
              <p class="gx-chatgpt-pane__accent">
                ChatGPT Desktop direction applied
              </p>
            </div>
          </section>
        </div>
      </main>

      <aside class="gx-chatgpt-explorer" aria-label="File explorer preview">
        <header class="gx-chatgpt-explorer__head">
          <span>Files</span>
          <button
            type="button"
            aria-label="File explorer options"
            onClick={NOOP}
          >
            <DeckIcon icon={MoreHorizontal} size={CHROME_ICON} />
          </button>
        </header>
        <div class="gx-chatgpt-explorer__body">
          <div class="gx-chatgpt-explorer__root">spacevibe-deck</div>
          <div
            class="gx-chatgpt-explorer__tree"
            role="tree"
            aria-label="spacevibe-deck files"
          >
            {EXPLORER_ROWS.map((row) => (
              <div
                key={`${row.depth}-${row.label}`}
                class={`gx-chatgpt-explorer__row ${"selected" in row && row.selected ? "is-selected" : ""}`}
                role="treeitem"
                aria-level={row.depth + 1}
                style={{ "--gx-explorer-depth": row.depth }}
              >
                <span
                  class={`gx-chatgpt-explorer__glyph is-${row.kind}`}
                  aria-hidden="true"
                >
                  <DeckIcon
                    icon={row.kind === "folder" ? FolderOpen : File}
                    size={CHROME_ICON}
                  />
                </span>
                <span>{row.label}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function ChromeSection() {
  return (
    <>
      <SectionHead
        title="Window chrome"
        blurb="Deck with ChatGPT Desktop is the selected gallery direction for the Electron window shell. The specimens beneath it cover component states rather than composition."
      />

      <Specimen
        name="Deck with ChatGPT Desktop"
        note="275px navigation rail · square hairline seams · 260px gallery-only explorer · terminal remains the focal artifact"
        surface="none"
        tall
      >
        <div class="gx-chatgpt-direction">
          <DesktopChrome
            sidebar
            toolbar={chatGptToolbarSpecimen()}
            sidebarNavigation={repositorySidebarSpecimen()}
            topTabs={null}
            stage={<ChatGptTerminalStage />}
            status={null}
            onMacTitlebarDoubleClick={NOOP}
          />
        </div>
      </Specimen>

      {/*
        Component-state coverage, not composition review — which is why the
        narrowing to one direction above left these standing
        (docs/specs/2026-08-12-agent-workbench-gallery-design.md §3.3). Nothing
        else in the gallery shows all seven update phases at once.
      */}

      <Specimen
        name="AgentAttentionMark"
        note="every kind the rail can summarise; idle renders nothing at all"
        surface="chrome-1"
      >
        <div class="gx-inline">
          {SEED_ATTENTION.map((summary) => (
            <span key={summary.kind} class="gx-inline__item">
              <StateLabel>{summary.kind}</StateLabel>
              <span class="tab__attn">
                <AgentAttentionMark
                  summary={summary}
                  label={`${summary.kind} tab`}
                  onActivate={NOOP}
                />
              </span>
            </span>
          ))}
        </div>
      </Specimen>

      <Specimen
        name="UpdateAction"
        note="all seven visible phases — the app only ever shows one"
        surface="chrome-1"
      >
        <div class="gx-inline">
          {UPDATE_PHASES.map((phase) => (
            <span key={phase} class="gx-inline__item">
              <StateLabel>{phase}</StateLabel>
              <UpdateAction
                view={{
                  phase,
                  currentVersion: "0.12.2",
                  availableVersion: "0.12.3",
                  notes: "Fixes the thing.",
                }}
                onDownload={NOOP}
                onInstall={NOOP}
                onRelaunch={NOOP}
              />
            </span>
          ))}
        </div>
      </Specimen>

      <Specimen
        name="WorkspaceSpinner · PresetThumb"
        note="DL-14.6 exempts both from the icon system — one is a status visual, one is a diagram"
        surface="chrome-1"
      >
        <div class="gx-inline">
          <span class="gx-inline__item">
            <StateLabel>agent pending</StateLabel>
            <WorkspaceSpinner />
          </span>
          <span class="gx-inline__item">
            <StateLabel>layout thumbnail</StateLabel>
            <PresetThumb layout={SEED_LAYOUT} />
          </span>
        </div>
      </Specimen>
    </>
  );
}
