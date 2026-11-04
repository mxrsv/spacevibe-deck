import { CaretDown, DownloadSimple, FolderOpen, GitBranch, Warning } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { AgentOption } from "../lib/agent-catalog";
import type { LaunchCommandChoices } from "../lib/launch-command";
import type { LaunchCommandOverride } from "../terminal/agent-launch-target";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import { Button } from "../ui/controls/button";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import { Input } from "../ui/controls/input";
import { Chord } from "../ui/blocks/chord";
import { Kbd } from "../ui/controls/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/controls/tooltip";
import { AgentInstallControl } from "./agent-install-control";
import {
  activeCommand,
  barProjectHits,
  enterAction,
  filterAgents,
  profileOverrides,
  projectInitials,
  resolveDefaultPick,
  runLabel,
  runnableIds,
  togglePick,
  type CommandBarProject,
} from "./command-bar-model";
import { CommandBarProfileMenu } from "./command-bar-profile-menu";
import { CommandBarProjectMenu } from "./command-bar-project-menu";
import type { LaunchProfileSection } from "./launch-profile-popover";
import "./command-bar.css";

const DEFAULT_OPEN_FOLDER_KEYS: readonly string[] = ["⌘", "O"];

export interface CommandBarProps {
  /** Every project, most recent first. Empty is first run. */
  readonly projects: readonly CommandBarProject[];
  /** The target project's path; null while there is none. */
  readonly currentPath: string | null;
  /** The quick agents, in the order Settings → Agents gives them. */
  readonly agents: readonly AgentOption[];
  /** Each runnable agent's launch commands, keyed by agent id. */
  readonly commands: Readonly<Record<string, LaunchCommandChoices>>;
  /** The agents a visit to this project starts picked: its last-run agent. */
  readonly defaultPick: readonly string[];
  /** The agent the launcher was opened beside, when it was opened from a live space. */
  readonly beside?: string | null;
  /** Over a live space: a floating panel at the stage's top instead of a centred bar. */
  readonly floating?: boolean;
  /** No workspace yet: Open folder and Clone replace the bar, and the chips are disabled. */
  readonly firstRun?: boolean;
  readonly pending?: boolean;
  /** Why the last launch failed before its pane existed. */
  readonly failure?: string | null;
  /** Takes focus, and answers Escape, only while true. */
  readonly active?: boolean;
  /** Key caps of the Open folder shortcut, as the platform writes them. */
  readonly openFolderKeys?: readonly string[];
  /** Run these agents, left to right. A profile override appears only for an agent off its default. */
  readonly onRun: (
    agentIds: readonly string[],
    overrides: Readonly<Record<string, LaunchCommandOverride>>,
  ) => void;
  readonly onPickProject: (path: string) => void;
  readonly onOpenFolder: () => void;
  readonly onNewWorktree: () => void;
  readonly onClone: () => void;
  readonly onRetry: () => void;
  /** Escape with nothing left to dismiss in the bar. */
  readonly onClose?: () => void;
  /** Settings → Agents, from the profile menu. */
  readonly onEditProfiles?: () => void;
}

interface PickState {
  readonly key: string;
  readonly ids: readonly string[];
}

/** LCH-5: the start surface's one bar. */
export function CommandBar(props: CommandBarProps) {
  const { agents, commands, projects, currentPath, firstRun = false } = props;
  const pending = props.pending === true;
  const active = props.active !== false;
  const current = projects.find((project) => project.path === currentPath) ?? null;

  const filterField = useRef<HTMLElement>(null);
  const openField = useRef<HTMLElement>(null);
  const chip = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // A profile pick lives and dies with this visit, as it does on the launch page.
  const [profilePicks, setProfilePicks] = useState<Readonly<Record<string, string>>>({});

  // The pick restarts from the default whenever the target project or its default changes.
  const pickKey = `${currentPath ?? ""}|${props.defaultPick.join(",")}`;
  const [pickState, setPickState] = useState<PickState | null>(null);
  const runnable = new Set(runnableIds(agents));
  const defaults = resolveDefaultPick(props.defaultPick, agents);
  const stored = pickState?.key === pickKey ? pickState.ids.filter((id) => runnable.has(id)) : [];
  const picked = stored.length > 0 ? stored : defaults;

  const shownAgents = filterAgents(agents, commands, query);
  const hits = barProjectHits(projects, query, currentPath);
  const canRun = !firstRun && !pending && picked.length > 0;

  useLayoutEffect(() => {
    if (active) (firstRun ? openField : filterField).current?.focus();
  }, [active, firstRun]);

  const run = (ids: readonly string[]): void => {
    if (firstRun || pending || ids.length === 0) return;
    props.onRun(ids, profileOverrides(ids, commands, profilePicks));
  };

  const pickProject = (path: string): void => {
    setMenuOpen(false);
    setQuery("");
    props.onPickProject(path);
    filterField.current?.focus();
  };

  const sections: readonly LaunchProfileSection[] = agents.flatMap((agent) => {
    const choices = commands[agent.id];
    return agent.missing || choices === undefined
      ? []
      : [
          {
            id: agent.id,
            label: agent.label,
            choices,
            active: activeCommand(choices, profilePicks[agent.id]) ?? choices.default,
          },
        ];
  });

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.defaultPrevented) return;
    if (event.key === "Escape") {
      // The project menu answers its own Escape first (it stops the event), so this one is the bar's.
      event.preventDefault();
      event.stopPropagation();
      if (query !== "") setQuery("");
      else props.onClose?.();
      return;
    }
    if (event.key !== "Enter") return;
    // A button's Enter is that button's press.
    if ((event.target as Element).closest("button, [role=option], [role=menuitem]") !== null) {
      return;
    }
    event.preventDefault();
    const action = enterAction(query, agents, commands, hits);
    if (action.kind === "run-agent") run([action.agentId]);
    else if (action.kind === "pick-project") pickProject(action.path);
    else run(picked);
  }

  return (
    <section
      class={`command-bar ui-preset${props.floating === true ? " command-bar--floating" : ""}`}
      aria-label="Launcher"
      onKeyDown={onKeyDown}
    >
      <div class="command-bar__bar">
        {firstRun ? (
          <>
            <Button size="xl" ref={openField} onClick={props.onOpenFolder}>
              <DeckIcon icon={FolderOpen} size={ROW_ICON} />
              Open folder
              <Chord keys={props.openFolderKeys ?? DEFAULT_OPEN_FOLDER_KEYS} />
            </Button>
            <Button size="xl" variant="secondary" onClick={props.onClone}>
              <DeckIcon icon={DownloadSimple} size={ROW_ICON} />
              Clone
            </Button>
            <span class="command-bar__first-hint">or drop a folder anywhere</span>
          </>
        ) : (
          <>
            <Button
              size="xl"
              variant="secondary"
              ref={chip}
              className="command-bar__project"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-label={current === null ? "Choose a project" : `Project ${current.name}`}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {current === null ? null : (
                <span class="command-bar__avatar" aria-hidden="true">
                  {projectInitials(current.name)}
                </span>
              )}
              <span class="command-bar__project-name">{current?.name ?? "Project"}</span>
              {current?.branch ? (
                <span class="command-bar__branch command-bar__meta">
                  <DeckIcon icon={GitBranch} size={ROW_ICON} />
                  <span class="command-bar__branch-name">{current.branch}</span>
                </span>
              ) : null}
              <DeckIcon icon={CaretDown} size={ROW_ICON} class="command-bar__caret-mark" />
            </Button>
            <Input
              ref={filterField}
              className="command-bar__filter"
              aria-label="Filter agents or projects"
              placeholder="Filter agents or projects"
              value={query}
              autocomplete="off"
              spellcheck={false}
              onInput={(event: Event) => setQuery((event.target as HTMLInputElement).value)}
            />
            <div class="command-bar__run">
              <Button size="xl" disabled={!canRun} onClick={() => run(picked)}>
                {runLabel(picked.length)}
                <Kbd>↵</Kbd>
              </Button>
              {sections.length === 0 ? null : (
                <CommandBarProfileMenu
                  sections={sections}
                  disabled={!canRun}
                  onPick={(agentId, command) =>
                    setProfilePicks((others) => ({ ...others, [agentId]: command }))
                  }
                  onEditProfiles={props.onEditProfiles}
                />
              )}
            </div>
            {menuOpen ? (
              <CommandBarProjectMenu
                projects={projects}
                currentPath={currentPath}
                anchorRef={chip}
                openFolderKeys={props.openFolderKeys ?? DEFAULT_OPEN_FOLDER_KEYS}
                onPick={pickProject}
                onOpenFolder={() => {
                  setMenuOpen(false);
                  props.onOpenFolder();
                }}
                onNewWorktree={() => {
                  setMenuOpen(false);
                  props.onNewWorktree();
                }}
                onClose={() => {
                  setMenuOpen(false);
                  chip.current?.focus();
                }}
              />
            ) : null}
          </>
        )}
      </div>
      {hits.length === 0 ? null : (
        <div class="command-bar__hits">
          {hits.map((project, at) => (
            <Button
              key={project.path}
              variant="ghost"
              className="command-bar__hit"
              data-first={at === 0 ? "" : undefined}
              onClick={() => pickProject(project.path)}
            >
              <span class="command-bar__avatar" aria-hidden="true">
                {projectInitials(project.name)}
              </span>
              {project.name}
              {project.age === null ? null : (
                <span class="command-bar__hit-age command-bar__meta">{project.age}</span>
              )}
            </Button>
          ))}
        </div>
      )}
      <div class="command-bar__chips" data-off={firstRun ? "" : undefined}>
        {shownAgents.map((agent) => (
          <AgentChip
            key={agent.id}
            agent={agent}
            on={picked.includes(agent.id)}
            disabled={firstRun || pending}
            command={activeCommand(commands[agent.id], profilePicks[agent.id])}
            onPress={(additive) =>
              setPickState({ key: pickKey, ids: togglePick(picked, agent.id, additive) })
            }
          />
        ))}
        <span class="command-bar__hint command-bar__meta">
          <Kbd>⇧</Kbd> adds
        </span>
      </div>
      {props.failure ? (
        <div class="command-bar__failure" role="alert">
          <DeckIcon icon={Warning} size={ROW_ICON} />
          <span class="command-bar__failure-text">{props.failure}</span>
          <Button size="sm" variant="secondary" disabled={pending} onClick={props.onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
      {firstRun || current === null ? null : (
        <p class="command-bar__destination">
          {props.beside ? (
            <>
              Beside <b>{props.beside}</b>
            </>
          ) : (
            <>
              New space in <b>{current.name}</b>
            </>
          )}
        </p>
      )}
    </section>
  );
}

interface AgentChipProps {
  readonly agent: AgentOption;
  readonly on: boolean;
  readonly disabled: boolean;
  /** The exact command a press of this agent types now. */
  readonly command: string | null;
  readonly onPress: (additive: boolean) => void;
}

/** Icon-only and muted until picked; a picked chip carries its name. */
function AgentChip({ agent, on, disabled, command, onPress }: AgentChipProps) {
  const glyph = (
    <>
      <AgentGlyph
        agent={agent.id.startsWith("custom:") ? agent.label : agent.id}
        className="command-bar__glyph"
      />
      <span class="command-bar__chip-name" aria-hidden={on ? undefined : "true"}>
        {agent.label}
      </span>
    </>
  );
  if (agent.missing) {
    return (
      <span class="command-bar__missing">
        <Button
          size="lg"
          variant="secondary"
          className="command-bar__chip"
          disabled
          aria-label={`${agent.label} is not installed`}
        >
          {glyph}
        </Button>
        <AgentInstallControl agentId={agent.id} label={agent.label} />
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="lg"
            variant="secondary"
            className="command-bar__chip"
            data-on={on ? "" : undefined}
            aria-pressed={on}
            aria-label={agent.label}
            disabled={disabled}
            onClick={(event: MouseEvent) => onPress(event.shiftKey)}
          />
        }
      >
        {glyph}
      </TooltipTrigger>
      <TooltipContent>
        <code class="command-bar__command">{command ?? agent.label}</code>
      </TooltipContent>
    </Tooltip>
  );
}
