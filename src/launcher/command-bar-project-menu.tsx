import { FolderOpenIcon, GitForkIcon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Chord } from "../ui/blocks/chord";
import { Button } from "../ui/controls/button";
import { DeckIcon, GLYPH_ROW } from "../ui/controls/deck-icon";
import { Input } from "../ui/controls/input";
import {
  matchParts,
  matchProjects,
  reduceMenuKey,
  type CommandBarProject,
} from "./command-bar-model";
import { CommandBarProjectLogo } from "./command-bar-project-logo";
import "./command-bar.css";

export interface CommandBarProjectMenuProps {
  /** Every project, most recent first. */
  readonly projects: readonly CommandBarProject[];
  readonly currentPath: string | null;
  readonly onPick: (path: string) => void;
  readonly onOpenFolder: () => void;
  readonly onNewWorktree: () => void;
  readonly openFolderKeys: readonly string[];
  /** Escape, or a press outside the menu and its anchor. */
  readonly onClose: () => void;
  /** The chip that opened the menu: a press on it is the chip's to answer, not an outside press. */
  readonly anchorRef: RefObject<HTMLElement>;
}

const LIST_KEYS = ["ArrowDown", "ArrowUp", "Enter", "Escape"];
const LIST_ID = "command-bar-project-list";
const rowId = (path: string): string => `command-bar-project-${path}`;

/**
 * LCH-5: the project menu. A search that takes focus on open, every project under it in a list
 * that scrolls inside itself, then a rule and the two actions that stay put below the list.
 * Typing filters all of history; the arrows move a highlight kept in view, Enter picks.
 */
export function CommandBarProjectMenu(props: CommandBarProjectMenuProps) {
  const { projects, currentPath, anchorRef, onClose } = props;
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const rows = matchProjects(projects, query);
  const highlighted = rows[Math.min(index, Math.max(0, rows.length - 1))];

  useLayoutEffect(() => {
    search.current?.focus();
  }, []);

  // The highlight stays in view whatever moved it.
  useLayoutEffect(() => {
    list.current
      ?.querySelector<HTMLElement>("[data-highlighted]")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [index, query]);

  useEffect(() => {
    const dismiss = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (root.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [anchorRef, onClose]);

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    // Enter on an action button is that button's press; only the search owns the list keys.
    const listKey = event.target === search.current;
    if (!(listKey ? LIST_KEYS : ["Escape"]).includes(event.key)) return;
    const result = reduceMenuKey(index, event.key, rows.length);
    // The bar's own Enter and Escape must not also answer a key the menu took.
    event.preventDefault();
    event.stopPropagation();
    if (result.action === "close") onClose();
    else if (result.action === "pick" && highlighted !== undefined) props.onPick(highlighted.path);
    else setIndex(result.index);
  }

  return (
    <div class="command-bar-menu" ref={root} onKeyDown={onKeyDown}>
      <div class="command-bar-menu__search">
        <DeckIcon icon={Search01Icon} size={GLYPH_ROW} />
        <Input
          ref={search}
          role="combobox"
          aria-label="Find a project"
          aria-expanded="true"
          aria-controls={LIST_ID}
          aria-activedescendant={highlighted === undefined ? undefined : rowId(highlighted.path)}
          placeholder={`Find in ${projects.length} projects`}
          value={query}
          autocomplete="off"
          spellcheck={false}
          onInput={(event: Event) => {
            setQuery((event.target as HTMLInputElement).value);
            setIndex(0);
          }}
        />
      </div>
      <div class="command-bar-menu__list" id={LIST_ID} role="listbox" ref={list}>
        {rows.length === 0 ? (
          <p class="command-bar-menu__empty">No project matches</p>
        ) : (
          rows.map((project, at) => {
            const parts = matchParts(project.name, query);
            const on = project === highlighted;
            return (
              <Button
                key={project.path}
                id={rowId(project.path)}
                variant="ghost"
                role="option"
                aria-selected={on}
                aria-current={project.path === currentPath ? "true" : undefined}
                data-highlighted={on ? "" : undefined}
                tabIndex={-1}
                className="command-bar-menu__row"
                onMouseMove={() => setIndex(at)}
                onClick={() => props.onPick(project.path)}
              >
                <CommandBarProjectLogo path={project.path} />
                <span class="command-bar-menu__name" data-filtered={query === "" ? undefined : ""}>
                  {parts.before}
                  {parts.match === "" ? null : <b>{parts.match}</b>}
                  {parts.after}
                </span>
                {project.path === currentPath ? (
                  <DeckIcon icon={Tick02Icon} size={GLYPH_ROW} class="command-bar-menu__end" />
                ) : project.age === null ? null : (
                  <span class="command-bar-menu__end command-bar__meta">{project.age}</span>
                )}
              </Button>
            );
          })
        )}
      </div>
      <div class="command-bar-menu__rule" role="separator" />
      <Button variant="ghost" className="command-bar-menu__action" onClick={props.onOpenFolder}>
        <DeckIcon icon={FolderOpenIcon} size={GLYPH_ROW} />
        Open folder…
        <span class="command-bar-menu__end">
          <Chord keys={props.openFolderKeys} />
        </span>
      </Button>
      <Button variant="ghost" className="command-bar-menu__action" onClick={props.onNewWorktree}>
        <DeckIcon icon={GitForkIcon} size={GLYPH_ROW} />
        New worktree…
      </Button>
    </div>
  );
}
