/**
 * The three forms spec decision 8 asks the owner to choose between.
 *
 * Each is drawn in its bold form (patterns do not bind a specimen). The real
 * `ExplorerTab` is the tree wherever the variant keeps the tree; only the list
 * rows are drawn, from `changes-specimens-parts.tsx`. Variant C prunes the
 * tree, which the real component cannot do, so it draws its rows on the
 * shipping row classes instead.
 */
import type { ComponentChildren } from "preact";
import {
  ArrowClockwise,
  ArrowsInLineVertical,
  CaretDown,
  CaretRight,
  FilePlus,
  FolderPlus,
  FolderSimple,
  GitDiff,
} from "@phosphor-icons/react";
import { ExplorerTab } from "../../files/ui/explorer-tab";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import { chevronForRow, iconForRow } from "../../files/ui/file-icons";
import type { TreeRow } from "../../files/file-tree";
import { CHROME_ICON, DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import {
  BRANCH,
  CHANGES,
  COMPARISON,
  ROOT,
  TOTALS,
  TREE,
  changeTooltip,
  prunedTree,
  splitPath,
  type ChangeEntry,
  type TreeNode,
} from "./changes-specimens-data";
import {
  BranchLabel,
  ChangeRow,
  Counts,
  EmptyState,
  EntryCounts,
  RefreshButton,
  StatusLine,
  StatusMark,
  TIMEOUT_MESSAGE,
} from "./changes-specimens-parts";

export type ViewState = "populated" | "clean" | "error";

interface VariantProps {
  readonly controller: FileSurfaceController;
  readonly state: ViewState;
  readonly width: number;
}

const WORKSPACE_NAME = splitPath(ROOT).name;

function List({ children }: { readonly children: ComponentChildren }) {
  return (
    <div class="chgx-list" role="list" aria-label="Changed files">
      {children}
    </div>
  );
}

function Entries({ state }: { readonly state: ViewState }) {
  if (state === "clean") {
    return <EmptyState />;
  }
  return (
    <List>
      {CHANGES.map((entry) => (
        <ChangeRow key={entry.path} entry={entry} />
      ))}
    </List>
  );
}

const statusLine = (state: ViewState) =>
  state === "error" ? <StatusLine failed>{TIMEOUT_MESSAGE}</StatusLine> : null;

/* ── A · a Files / Changes switch at the Explorer's head ─────────── */

export function VariantA({
  controller,
  state,
  width,
  view = "changes",
}: VariantProps & { readonly view?: "files" | "changes" }) {
  return (
    <div class="chgx-frame" style={{ width: `${width}px` }}>
      {statusLine(state)}
      <div class="chgx-switch" role="tablist" aria-label="Explorer view">
        <button
          type="button"
          role="tab"
          class="chgx-switch__tab"
          aria-selected={view === "files"}
          title="Files"
        >
          <DeckIcon icon={FolderSimple} size={CHROME_ICON} />
          Files
        </button>
        <button
          type="button"
          role="tab"
          class="chgx-switch__tab"
          aria-selected={view === "changes"}
          title={`Changes\n${COMPARISON}`}
        >
          <DeckIcon icon={GitDiff} size={CHROME_ICON} />
          Changes
          {state !== "clean" && <Counts added={TOTALS.added} removed={TOTALS.removed} />}
        </button>
      </div>
      {view === "files" ? (
        <div class="chgx-region">
          <ExplorerTab controller={controller} workspacePath={ROOT} canCreate />
        </div>
      ) : (
        <div class="chgx-region chgx-region--list">
          {/* The Changes side's first row stands where the root row stands:
              it names what the tab shows (the branch) and carries its action. */}
          <div class="chgx-head">
            <BranchLabel />
            <span class="file-tree__actions">
              <RefreshButton />
            </span>
          </div>
          <Entries state={state} />
        </div>
      )}
    </div>
  );
}

/* ── B · a collapsible Changes section above the tree ────────────── */

export function VariantB({
  controller,
  state,
  width,
  collapsed = false,
}: VariantProps & { readonly collapsed?: boolean }) {
  return (
    <div class="chgx-frame" style={{ width: `${width}px` }}>
      {statusLine(state)}
      <div class="chgx-head chgx-head--section" role="button" aria-expanded={!collapsed}>
        <span class="chgx-head__caret">
          <DeckIcon icon={collapsed ? CaretRight : CaretDown} size={ROW_ICON} />
        </span>
        <span class="chgx-head__label" title={COMPARISON}>
          Changes
        </span>
        <BranchLabel muted />
        <span class="chgx-head__right">
          {state !== "clean" && <Counts added={TOTALS.added} removed={TOTALS.removed} />}
          <span class="file-tree__actions">
            <RefreshButton />
          </span>
        </span>
      </div>
      {!collapsed && (
        <div class="chgx-section-body">
          <Entries state={state} />
        </div>
      )}
      <div class="chgx-region chgx-region--tree">
        <ExplorerTab controller={controller} workspacePath={ROOT} canCreate />
      </div>
    </div>
  );
}

/* ── C · a "changed only" filter on the tree's root row ─────────── */

const EXPANDED_WHEN_OFF: ReadonlySet<string> = new Set(["src", "src/files"]);

function visibleWhenOff(): readonly TreeNode[] {
  return TREE.filter((node) => {
    const parts = node.path.split("/");
    for (let end = 1; end < parts.length; end += 1) {
      if (!EXPANDED_WHEN_OFF.has(parts.slice(0, end).join("/"))) {
        return false;
      }
    }
    return true;
  });
}

const entryAt = (path: string): ChangeEntry | undefined =>
  CHANGES.find((entry) => entry.path === path);

function treeRowFor(node: TreeNode, expanded: boolean): TreeRow {
  const { name } = splitPath(node.path);
  return {
    path: node.path,
    name,
    directory: node.directory,
    depth: node.path.split("/").length - 1,
    expanded,
    outOfRoot: false,
  };
}

function RootControl({
  label,
  icon,
  on = false,
}: {
  readonly label: string;
  readonly icon: typeof ArrowClockwise;
  readonly on?: boolean;
}) {
  return (
    <button
      type="button"
      class={`file-tree__action${on ? " chgx-filter is-on" : ""}`}
      aria-label={label}
      aria-pressed={on ? true : undefined}
      title={label}
    >
      <DeckIcon icon={icon} size={CHROME_ICON} />
    </button>
  );
}

export function VariantC({
  state,
  width,
  filter = true,
}: Omit<VariantProps, "controller"> & { readonly filter?: boolean }) {
  const nodes = filter ? (state === "clean" ? [] : prunedTree()) : visibleWhenOff();
  const rowCount = nodes.length + 1;
  return (
    <div class="chgx-frame" style={{ width: `${width}px` }}>
      {statusLine(state)}
      <div class="file-tree-shell">
        <div class="file-tree" role="tree" aria-label="File explorer">
          <div class="file-tree__rows" style={{ height: `${rowCount * 22}px` }}>
            <div
              class="file-tree__row is-root"
              role="treeitem"
              aria-expanded
              tabIndex={0}
              style={{ top: "0px", paddingLeft: "8px" }}
              title={filter ? `${BRANCH}\n${COMPARISON}` : ROOT}
            >
              <span class="file-tree__chevron">
                <DeckIcon icon={CaretDown} size={ROW_ICON} />
              </span>
              {filter ? <BranchLabel /> : <span class="file-tree__name">{WORKSPACE_NAME}</span>}
              {filter && state !== "clean" && (
                <Counts added={TOTALS.added} removed={TOTALS.removed} />
              )}
              <span class="file-tree__actions">
                <RootControl label="New file" icon={FilePlus} />
                <RootControl label="New folder" icon={FolderPlus} />
                <RootControl
                  label={filter ? "Show all files" : "Show changed files only"}
                  icon={GitDiff}
                  on={filter}
                />
                <RootControl label="Refresh" icon={ArrowClockwise} />
                <RootControl label="Collapse all" icon={ArrowsInLineVertical} />
              </span>
            </div>
            {nodes.map((node, index) => {
              const entry = filter ? entryAt(node.path) : undefined;
              const row = treeRowFor(
                node,
                node.directory && (filter || EXPANDED_WHEN_OFF.has(node.path)),
              );
              return (
                <div
                  key={node.path}
                  class="file-tree__row"
                  role="treeitem"
                  aria-level={row.depth + 2}
                  aria-expanded={node.directory ? row.expanded : undefined}
                  tabIndex={-1}
                  style={{
                    top: `${(index + 1) * 22}px`,
                    paddingLeft: `${8 + (row.depth + 1) * 14}px`,
                  }}
                  title={entry === undefined ? undefined : changeTooltip(entry)}
                >
                  <span
                    class="file-tree__chevron"
                    style={{ visibility: node.directory ? "visible" : "hidden" }}
                  >
                    <DeckIcon icon={chevronForRow(row)} size={ROW_ICON} />
                  </span>
                  <span class="file-tree__icon">
                    <DeckIcon icon={iconForRow(row)} size={ROW_ICON} />
                  </span>
                  <span
                    class={`file-tree__name${entry?.status === "deleted" ? " chgx-struck" : ""}`}
                  >
                    {row.name}
                  </span>
                  {entry !== undefined && (
                    <>
                      <span class="chgx-spacer" />
                      <StatusMark entry={entry} />
                      <EntryCounts entry={entry} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {filter && state === "clean" && <EmptyState />}
        </div>
      </div>
    </div>
  );
}
