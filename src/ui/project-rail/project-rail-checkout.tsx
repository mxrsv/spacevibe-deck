import {
  ComputerTerminal01Icon,
  Folder01Icon,
  FolderOpenIcon,
  GitBranchIcon,
  GitForkIcon,
  MoreHorizontalIcon,
  Settings02Icon,
  SquareSplitHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { cn } from "@/lib/cn";
import type { PaneAgent } from "../../lib/process-info";
import { checkoutLine, subjectOf } from "../agent-rail-card-model";
import type { RailWorktreeGroup } from "../agent-rail-model";
import { AgentGlyph } from "../controls/agent-glyph";
import { Button } from "../controls/button";
import { STATE_DISABLED, rowActionsGround, stateClasses } from "../blocks/recipe-classes";
import { DeckIcon, GLYPH_FEATURE, type DeckGlyph } from "../controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGap,
  DropdownMenuTrigger,
} from "../controls/dropdown-menu";
import { focusCheckout } from "../worktree-card";
import { whereOf } from "../worktree-card-row";
import { actionGroups, type CardActions } from "../worktree-card-menus";
import type { CheckoutActionGroups } from "./project-rail-commands";
import { recoverRailFocus } from "./project-rail-focus";
import { RailPopupGuard, REVEAL, Tip } from "./project-rail-menu-parts";

/** The shipped menu's non-agent rows, drawn with the rail's own glyphs. */
const ROW_ICONS: Readonly<Record<string, DeckGlyph>> = {
  shell: ComputerTerminal01Icon,
  split: SquareSplitHorizontalIcon,
  finder: FolderOpenIcon,
  "agents-settings": Settings02Icon,
};

/**
 * The shipped checkout menu's rows (quick agents, Open shell, New split here, Choose quick
 * agents, Open in Finder), grouped as it groups them. Each row's `run` is the handler that menu
 * calls, so an entry here does what it does there.
 */
export function ProjectRailCheckoutRows({ groups }: { readonly groups: CheckoutActionGroups }) {
  return (
    <>
      {groups.map((rows, at) => (
        <Fragment key={rows[0]?.id ?? at}>
          {at === 0 ? null : <DropdownMenuGap />}
          {rows.map((row) =>
            row.kind === "note" ? (
              <DropdownMenuItem key={row.id} disabled>
                <span className="truncate">{row.text}</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={row.id} onClick={row.run}>
                {row.agent === undefined ? (
                  <DeckIcon icon={ROW_ICONS[row.id] ?? ComputerTerminal01Icon} />
                ) : (
                  <AgentGlyph agent={row.agent as PaneAgent} className="size-4 shrink-0" />
                )}
                {row.title}
              </DropdownMenuItem>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

export interface ProjectRailCheckoutProps {
  /** The project's name, which the accessible name and the menu's subject read. */
  readonly project: string;
  readonly checkout: RailWorktreeGroup;
  /** The line the keyboard last stood on: its "+" is in the Tab order. */
  readonly active: boolean;
  readonly actions?: CardActions;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onSelectTab: (tabIndex: number) => void;
}

/**
 * A checkout with nothing open in a project that has several: a branch, worktree or folder
 * glyph and its name. Rows of a checkout that has some stay one list sorted across the project
 * (LAY-2), so this line is the way back into a checkout the list would otherwise not show.
 * A press opens the launch page on it, as the shipped label line does; the right-click and the
 * hover "+" raise the shipped checkout menu's actions.
 */
export function ProjectRailCheckout({
  project,
  checkout,
  active,
  actions,
  onFocusPane,
  onSelectTab,
}: ProjectRailCheckoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const line = checkoutLine(checkout);
  const where = whereOf(project, checkout);
  const GlyphIcon = !checkout.labelled
    ? Folder01Icon
    : checkout.primary
      ? GitBranchIcon
      : GitForkIcon;
  const launcher = actions?.onOpenAgentLauncher;
  const hasRows = checkout.entries.length > 0;
  const press = hasRows
    ? () => focusCheckout(checkout, onFocusPane, onSelectTab)
    : launcher === undefined
      ? undefined
      : () => launcher(checkout.path);
  const groups: CheckoutActionGroups =
    actions === undefined ? [] : actionGroups(actions, subjectOf(project, checkout));
  return (
    <div
      data-rail-item={`checkout:${checkout.key}`}
      className="group/item relative"
      onContextMenu={(event: MouseEvent) => {
        if (groups.length > 0) {
          event.preventDefault();
          setMenuOpen(true);
        }
      }}
    >
      {/* raw-control: a whole-row target; no Button variant spans a label line */}
      <button
        type="button"
        data-rail-checkout={checkout.key}
        aria-label={hasRows ? `Focus ${where}` : `New agent in ${where}`}
        disabled={press === undefined}
        onClick={press}
        className={cn(
          "flex h-(--row-32) w-full items-center gap-2 rounded-(--radius-control) pr-(--space-pad-row) pl-(--space-16) text-left text-sm text-(--text-muted)",
          stateClasses(false),
          STATE_DISABLED,
        )}
      >
        <DeckIcon icon={GlyphIcon} size={GLYPH_FEATURE} class="shrink-0" />
        <span className="min-w-0 truncate">{line.name}</span>
        {/* The tag is a word for assistive technology only: the glyph says it to the eye. */}
        {line.tag === null ? null : <span className="sr-only">{line.tag}</span>}
      </button>
      {groups.length === 0 ? null : (
        <div className={cn(rowActionsGround(false), REVEAL)}>
          <DropdownMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onOpenChangeComplete={(open: boolean) => {
              if (!open) {
                recoverRailFocus();
              }
            }}
          >
            <Tip
              label="More"
              button={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      tabIndex={active ? 0 : -1}
                      aria-label={`Actions for ${where}`}
                    />
                  }
                />
              }
            >
              <DeckIcon icon={MoreHorizontalIcon} />
            </Tip>
            <DropdownMenuContent align="end" className="min-w-44">
              <RailPopupGuard />
              <ProjectRailCheckoutRows groups={groups} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
