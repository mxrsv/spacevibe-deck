import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { AgentOption } from "../../lib/agent-catalog";
import { CommandBar, type CommandBarProps } from "../../launcher/command-bar";
import type { CommandBarProject } from "../../launcher/command-bar-model";
import { StageLauncherSlot } from "../../launcher/stage-launcher-slot";
import { RememberedRailRow } from "../../ui/project-rail/remembered-row";
import type { RememberedRowModel } from "../../ui/project-rail/remembered-rows";
import { DECK_DARK_ID, getTheme } from "../../settings/themes";
import { applyScopedTheme } from "../scoped-theme";
import { SectionHead, StateLabel } from "../specimen";
import "../../ui/preset-entry.css";
import "./launcher-section.css";

/**
 * The stage launcher, drawn from the shipping components next to the numbers the approved mock
 * (direction A, 2026-11-04) was measured at. The owner's dev build runs `graphite`, the release
 * build `deck-dark`, so both are drawn, graphite first. Each frame is the stage's size (1016 by
 * 756), and the rail row sits on the rail's colour at the rail's 264px.
 */

const NOOP = (): void => {};
const THEME_IDS = ["graphite", DECK_DARK_ID] as const;
const MENU_STEPS = 11;
const MENU_STEP_MS = 30;

const agent = (id: string, label: string): AgentOption => ({
  id,
  label,
  detail: id,
  missing: false,
});
const AGENTS: readonly AgentOption[] = [
  agent("claude", "Claude Code"),
  agent("codex", "Codex"),
  agent("gemini", "Gemini CLI"),
  agent("opencode", "OpenCode"),
  agent("droid", "Droid"),
  agent("amp", "Amp"),
  agent("cursor", "Cursor"),
  agent("copilot", "Copilot"),
];
const COMMANDS = Object.fromEntries(
  AGENTS.map((a) => [a.id, { default: a.id, commands: [a.id] }] as const),
);

const NAMES = [
  "spacevibe-board",
  "spacevibe-deck",
  "spacevibe-academy",
  "spacevibe-active",
  "spacevibe-cloud",
  "spacevibe-api",
  "spacevibe-bench",
  "spacevibe-hub",
  "spacevibe-giffcoffee",
  "tinysift",
  "kanban-vault",
  "dotfiles",
  "claude-skills",
  "landing-experiments",
  "notch-prototype",
  "voice-mvp",
  "kyantran",
  "spacevibe-workspace",
  "livestream-shorts",
  "playground",
  "deck-tauri-archive",
  "spacevibe-board-worktrees",
  "rust-notes",
];
const AGES = [null, "1h", "yesterday", "2d", "4d", "1w", "2w", "2w", "3w", "3w", "4w", "1mo"];
const projects = (count: number): readonly CommandBarProject[] =>
  NAMES.slice(0, count).map((name, at) => ({
    path: `/work/${name}`,
    name,
    branch: at < 5 ? "main" : null,
    age: AGES[at] ?? (at < 17 ? "1mo" : "2mo"),
  }));

const BOARD = "/work/spacevibe-board";

const base: Omit<CommandBarProps, "projects" | "currentPath" | "defaultPick"> = {
  agents: AGENTS,
  commands: COMMANDS,
  onRun: NOOP,
  onPickProject: NOOP,
  onOpenFolder: NOOP,
  onNewWorktree: NOOP,
  onClone: NOOP,
  onRetry: NOOP,
  active: false,
};

const REMEMBERED: readonly RememberedRowModel[] = [
  rememberedRow("claude", "Notch usage refresh"),
  rememberedRow("codex", "Usage parser review"),
];

function rememberedRow(agentId: string, title: string): RememberedRowModel {
  return {
    pane: {
      id: `gallery-${agentId}`,
      workspacePath: BOARD,
      cwd: BOARD,
      agent: agentId,
      launchCommand: null,
      title,
      branch: "main",
      sessionId: null,
      savedAt: Date.now() - 86_400_000,
    },
    title,
    branch: "main",
    folderOnly: false,
  };
}

/** The stage's rectangle, on the stage ground, with the slot's gutter. */
function Stage({ id, children }: { id: string; children: ComponentChildren }) {
  return (
    <div id={id} class="gx-lch-stage">
      {children}
    </div>
  );
}

/** Two panes the floating launcher dims, drawn only to give the scrim something to cover. */
function FakePanes() {
  return (
    <div class="gx-lch-panes" aria-hidden="true">
      {["Claude Code", "Codex"].map((name) => (
        <div key={name} class="gx-lch-pane">
          <div class="gx-lch-pane__head">{name}</div>
          <pre class="gx-lch-pane__term">
            {
              'resumed "Notch usage refresh"\nThe refresh timer now stops when the notch hides.\nTwo files changed; the suite passes.\n> '
            }
          </pre>
        </div>
      ))}
    </div>
  );
}

/** Opens the project menu and walks the highlight down, as a user would; the bar has no "open" prop. */
function MenuOpened({ children }: { children: ComponentChildren }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timers: number[] = [];
    const root = host.current;
    root?.querySelector<HTMLElement>(".command-bar__project")?.click();
    for (let step = 1; step <= MENU_STEPS; step += 1) {
      timers.push(
        window.setTimeout(
          () => {
            root
              ?.querySelector<HTMLElement>(".command-bar-menu input")
              ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
          },
          60 + step * MENU_STEP_MS,
        ),
      );
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  return <div ref={host}>{children}</div>;
}

function ThemeScope({ themeId, children }: { themeId: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current !== null) applyScopedTheme(ref.current, getTheme(themeId));
  }, [themeId]);
  return (
    <div ref={ref} id={`lch-${themeId}`} class="gx-lch-scope">
      <span class="gx-lch-scope__name">{themeId}</span>
      {children}
    </div>
  );
}

function Case({ id, label, children }: { id: string; label: string; children: ComponentChildren }) {
  return (
    <div class="gx-lch-case">
      <StateLabel>{label}</StateLabel>
      <Stage id={id}>{children}</Stage>
    </div>
  );
}

function Scene({ themeId }: { themeId: string }) {
  const key = (state: string): string => `lch-${themeId}-${state}`;
  const five = projects(5);
  return (
    <ThemeScope themeId={themeId}>
      <Case id={key("s1")} label="1 · resident, one agent picked">
        <StageLauncherSlot>
          <CommandBar {...base} projects={five} currentPath={BOARD} defaultPick={["claude"]} />
        </StageLauncherSlot>
      </Case>
      <Case id={key("s2")} label="2 · two picked">
        <StageLauncherSlot>
          <CommandBar
            {...base}
            projects={five}
            currentPath={BOARD}
            defaultPick={["claude", "codex"]}
          />
        </StageLauncherSlot>
      </Case>
      <Case id={key("s3")} label="3 · first run">
        <StageLauncherSlot>
          <CommandBar {...base} projects={[]} currentPath={null} defaultPick={[]} firstRun />
        </StageLauncherSlot>
      </Case>
      <Case id={key("s4")} label="4 · floating over a live space">
        <FakePanes />
        <StageLauncherSlot floating>
          <CommandBar
            {...base}
            projects={five}
            currentPath={BOARD}
            defaultPick={["claude"]}
            floating
            beside="Claude Code"
          />
        </StageLauncherSlot>
      </Case>
      <Case id={key("s5")} label="5 · project menu, 23 projects, highlight on row 12">
        <StageLauncherSlot>
          <MenuOpened>
            <CommandBar
              {...base}
              active
              projects={projects(23)}
              currentPath={BOARD}
              defaultPick={["claude"]}
            />
          </MenuOpened>
        </StageLauncherSlot>
      </Case>
      <div class="gx-lch-case">
        <StateLabel>6 · remembered rail rows at 264px (hover one for its hover look)</StateLabel>
        <div id={key("s6")} class="gx-lch-rail">
          {/* The rail's list sits inside `.ui-preset` on a transparent ground (project-rail.tsx). */}
          <div class="ui-preset gx-lch-rail__list">
            <RememberedRailRow row={REMEMBERED[0]} onResume={NOOP} onForget={NOOP} />
            <RememberedRailRow row={REMEMBERED[1]} onResume={NOOP} onForget={NOOP} />
          </div>
        </div>
      </div>
    </ThemeScope>
  );
}

export function LauncherSection() {
  return (
    <>
      <SectionHead
        title="stage launcher"
        blurb="The command bar and the remembered rail row, built from the shipping components with fake data and drawn at the stage's size. Graphite is the dev build's theme, deck-dark the release build's."
      />
      {THEME_IDS.map((themeId) => (
        <Scene key={themeId} themeId={themeId} />
      ))}
    </>
  );
}
