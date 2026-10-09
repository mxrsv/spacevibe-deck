/**
 * Three specimens for the Changes list's form (plan 2026-10-10-changes-list,
 * Task 0; spec decision 8). Patterns do not bind a specimen, so each variant
 * is drawn in its bold form with minimal text and names in tooltips.
 *
 * The Explorer tree is the real `ExplorerTab` over an inert client, as in
 * `explorer-tree-section.tsx`; only the list rows are drawn here. Variant C
 * prunes the tree, which the real view cannot do, so it draws its own rows
 * with the tree's classes. Never imported by shipping code (R7).
 */
import { useMemo } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  ArrowClockwise,
  ArrowsInLineVertical,
  CaretDown,
  CaretRight,
  FilePlus,
  FolderPlus,
  Funnel,
  GitBranch,
} from "@phosphor-icons/react";
import { ExplorerTab } from "../../files/ui/explorer-tab";
import { createFileSurfaceController } from "../../files/file-surface-controller";
import type { FileClient } from "../../files/file-client";
import { setListing, toggleDirectory } from "../../files/file-surface-store";
import type { DirEntry } from "../../files/file-tree";
import { directoryIcon, fileIcon } from "../../files/ui/file-icons";
import { CHROME_ICON, DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import { SectionHead } from "../specimen";
import {
  BRANCH,
  COMPARISON,
  ENTRIES,
  ERROR_LINE,
  STATUS_MARK,
  STATUS_WORD,
  TOTALS,
  type ChangeEntry,
} from "./changes-specimens-data";
import "./changes-specimens-section.css";

const ROOT = "/Users/deck/spacevibe-workspace/spacevibe-deck";

const dir = (parent: string, name: string): DirEntry => ({
  name,
  path: `${parent}/${name}`,
  directory: true,
  outOfRoot: false,
});
const file = (parent: string, name: string): DirEntry => ({
  name,
  path: `${parent}/${name}`,
  directory: false,
  outOfRoot: false,
});

const inertClient: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "gallery specimen" }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 0, size: 0 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 0, size: 0 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  createEntry: async (_root, parent, name) => ({ path: `${parent}/${name}` }),
  listenFileChanged: async () => () => {},
};

function seed(): void {
  setListing(ROOT, ROOT, [
    dir(ROOT, "electron"),
    dir(ROOT, "src"),
    file(ROOT, "AGENTS.md"),
    file(ROOT, "package.json"),
  ]);
}

type State = "populated" | "clean" | "error";
type VariantId = "A" | "B" | "C";

const counts = (entry: Pick<ChangeEntry, "added" | "removed">) =>
  entry.added === null ? (
    <span class="gx-chg-counts" title="Binary file">
      binary
    </span>
  ) : (
    <span class="gx-chg-counts">
      +{entry.added} −{entry.removed}
    </span>
  );

const Totals = () => (
  <span class="gx-chg-counts" title={COMPARISON}>
    +{TOTALS.added} −{TOTALS.removed}
  </span>
);

function Btn({ icon, label, on = false }: { icon: typeof Funnel; label: string; on?: boolean }) {
  return (
    <button
      type="button"
      class={`gx-chg-btn${on ? " is-on" : ""}`}
      title={label}
      aria-label={label}
    >
      <DeckIcon icon={icon} size={CHROME_ICON} />
    </button>
  );
}

function ChangeRow({ entry }: { entry: ChangeEntry }) {
  const title =
    entry.status === "renamed" && entry.oldPath !== undefined
      ? `${STATUS_WORD[entry.status]} from ${entry.oldPath}`
      : `${STATUS_WORD[entry.status]}: ${entry.dir}/${entry.name}`;
  return (
    <div class={`gx-chg-row${entry.status === "deleted" ? " is-deleted" : ""}`} title={title}>
      <span class="gx-chg-mark">{STATUS_MARK[entry.status]}</span>
      <span class="gx-chg-row__name">{entry.name}</span>
      <span class="gx-chg-row__dir">{entry.dir}</span>
      {counts(entry)}
    </div>
  );
}

/** The list body for a state; `error` keeps the last good list under a red line. */
function ListBody({ state }: { state: State }) {
  if (state === "clean") {
    return <p class="gx-chg-empty">No changes against HEAD.</p>;
  }
  return (
    <div class="gx-chg-list">
      {ENTRIES.map((entry) => (
        <ChangeRow key={entry.dir + entry.name} entry={entry} />
      ))}
    </div>
  );
}

const StatusLine = ({ state }: { state: State }) =>
  state === "error" ? (
    <p class="gx-chg-status is-failure" role="status">
      {ERROR_LINE}
    </p>
  ) : null;

function Tree({ controller }: { controller: ReturnType<typeof createFileSurfaceController> }) {
  return (
    <div class="gx-chg-frame__tree">
      <ExplorerTab controller={controller} workspacePath={ROOT} canCreate />
    </div>
  );
}

type Controller = ReturnType<typeof createFileSurfaceController>;

/* ── A: Files / Changes switch ─────────────────────────────── */
function VariantA({
  state,
  controller,
  side,
}: {
  state: State;
  controller: Controller;
  side: "changes" | "files";
}) {
  return (
    <>
      <div class="gx-chg-switch" role="tablist">
        <button type="button" class={`gx-chg-switch__seg${side === "files" ? " is-active" : ""}`}>
          Files
        </button>
        <button type="button" class={`gx-chg-switch__seg${side === "changes" ? " is-active" : ""}`}>
          Changes
          {state === "clean" ? null : <Totals />}
        </button>
      </div>
      {side === "files" ? (
        <Tree controller={controller} />
      ) : (
        <>
          <div class="gx-chg-head" title={`${BRANCH} · ${COMPARISON}`}>
            <DeckIcon icon={GitBranch} size={ROW_ICON} />
            <span class="gx-chg-head__branch">{BRANCH}</span>
            <span class="gx-chg-head__right">
              <Btn icon={ArrowClockwise} label="Refresh" />
            </span>
          </div>
          <StatusLine state={state} />
          <ListBody state={state} />
        </>
      )}
    </>
  );
}

/* ── B: collapsible section above the tree ─────────────────── */
function VariantB({
  state,
  controller,
  open,
}: {
  state: State;
  controller: Controller;
  open: boolean;
}) {
  return (
    <>
      <div class="gx-chg-section">
        <div class="gx-chg-head" title={`${BRANCH} · ${COMPARISON}`}>
          <DeckIcon icon={open ? CaretDown : CaretRight} size={ROW_ICON} />
          <span>Changes</span>
          <span class="gx-chg-head__branch gx-chg-faint">{BRANCH}</span>
          <span class="gx-chg-head__right">
            {state === "clean" ? null : <Totals />}
            <Btn icon={ArrowClockwise} label="Refresh" />
          </span>
        </div>
        {open && (
          <>
            <StatusLine state={state} />
            <ListBody state={state} />
          </>
        )}
      </div>
      <Tree controller={controller} />
    </>
  );
}

/* ── C: "changed only" filter on the tree ──────────────────── */
interface PrunedRow {
  readonly depth: number;
  readonly name: string;
  readonly entry: ChangeEntry | null;
}

function pruned(): readonly PrunedRow[] {
  const rows: PrunedRow[] = [];
  const seen = new Set<string>();
  const sorted = [...ENTRIES].sort((a, b) =>
    `${a.dir}/${a.name}`.localeCompare(`${b.dir}/${b.name}`),
  );
  for (const entry of sorted) {
    const parts = entry.dir.split("/");
    parts.forEach((part, index) => {
      const key = parts.slice(0, index + 1).join("/");
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ depth: index + 1, name: part, entry: null });
      }
    });
    rows.push({ depth: parts.length + 1, name: entry.name, entry });
  }
  return rows;
}

function VariantC({ state }: { state: State }) {
  const rows = useMemo(pruned, []);
  return (
    <>
      <StatusLine state={state} />
      <div class="gx-chg-tree">
        <div class="file-tree__row is-root" style={{ position: "static" }}>
          <span class="file-tree__chevron">
            <DeckIcon icon={CaretDown} size={ROW_ICON} />
          </span>
          <span class="file-tree__name">spacevibe-deck</span>
          <span class="file-tree__actions">
            <Btn icon={Funnel} label="Changed files only" on />
            <Btn icon={FilePlus} label="New file" />
            <Btn icon={FolderPlus} label="New folder" />
            <Btn icon={ArrowClockwise} label="Refresh" />
            <Btn icon={ArrowsInLineVertical} label="Collapse all" />
          </span>
        </div>
        {state === "clean" ? (
          <p class="gx-chg-empty">No changed files.</p>
        ) : (
          rows.map((row) => (
            <div
              key={`${row.depth}${row.name}${row.entry?.dir ?? ""}`}
              class={`file-tree__row${row.entry?.status === "deleted" ? " is-deleted" : ""}`}
              style={{ position: "static", paddingLeft: `${8 + row.depth * 12}px` }}
              title={row.entry === null ? row.name : STATUS_WORD[row.entry.status]}
            >
              <span class="file-tree__icon">
                <DeckIcon
                  icon={row.entry === null ? directoryIcon(true) : fileIcon(row.name)}
                  size={ROW_ICON}
                />
              </span>
              <span class="file-tree__name">{row.name}</span>
              {row.entry !== null && (
                <>
                  <span class="gx-chg-mark" style={{ marginLeft: "auto" }}>
                    {STATUS_MARK[row.entry.status]}
                  </span>
                  {counts(row.entry)}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}

function Frame({
  id,
  state,
  width,
  controller,
  variant,
}: {
  id: string;
  state: State;
  width: number;
  controller: Controller;
  variant: VariantId | "A-files" | "B-collapsed";
}) {
  let body: ComponentChildren;
  if (variant === "A") body = <VariantA state={state} controller={controller} side="changes" />;
  else if (variant === "A-files")
    body = <VariantA state={state} controller={controller} side="files" />;
  else if (variant === "B") body = <VariantB state={state} controller={controller} open />;
  else if (variant === "B-collapsed")
    body = <VariantB state={state} controller={controller} open={false} />;
  else body = <VariantC state={state} />;
  return (
    <div>
      <p class="gx-chg-label">
        {id} · {width}px
      </p>
      <div class="gx-chg-frame" data-specimen={id} style={{ width: `${width}px` }}>
        {body}
      </div>
    </div>
  );
}

const CARDS: Readonly<
  Record<VariantId, { title: string; lines: readonly string[]; fork?: string }>
> = {
  A: {
    title: "A — Files / Changes switch",
    lines: [
      "Amends DL-19.9: the first row names one of two views; while Changes is shown it replaces the root row's name and actions.",
      "Amends DL-19.7 too if the switch moves into the dock header. The active side takes DL-21.1.",
    ],
  },
  B: {
    title: "B — collapsible Changes section above the tree",
    lines: [
      "Amends DL-19.9: a second action-bearing row (the section header carries Refresh).",
      "Amends the root-is-row-0 model (file-surface.md:64): two scroll regions in a 360px column. Collapsed it is one 22px row.",
    ],
  },
  C: {
    title: "C — “changed only” filter on the tree",
    lines: [
      "Amends DL-19.9: five 17px controls on the root row at 360px.",
      "Contradicts the spec: decision 1 (no git markers on tree rows) and Out of scope (filter-in-tree) need rewording if C wins.",
    ],
    fork: "Fork: painting the filter's on state with --accent would break the DL-21.8 invariant.",
  },
};

export function ChangesSpecimensSection() {
  const controller = useMemo(() => {
    seed();
    const created = createFileSurfaceController({ client: inertClient });
    toggleDirectory(ROOT, `${ROOT}/src`);
    return created;
  }, []);

  return (
    <section class="gx-section">
      <SectionHead
        title="changes specimens"
        blurb="Three forms for the Changes list (spec decision 8). Fake data; 8 entries, one of each status. Pick one at eye review."
      />
      {(["A", "B", "C"] as const).map((id) => (
        <div key={id}>
          <p class="gx-chg-cap">{CARDS[id].title}</p>
          <div class="gx-chg-card">
            {CARDS[id].lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
            {CARDS[id].fork !== undefined && <div class="is-fork">{CARDS[id].fork}</div>}
          </div>
          <div class="gx-chg-frames">
            <Frame
              id={`${id}-populated`}
              variant={id}
              state="populated"
              width={360}
              controller={controller}
            />
            <Frame
              id={`${id}-populated`}
              variant={id}
              state="populated"
              width={520}
              controller={controller}
            />
            {id === "A" && (
              <Frame
                id="A-files"
                variant="A-files"
                state="populated"
                width={360}
                controller={controller}
              />
            )}
            {id === "B" && (
              <Frame
                id="B-collapsed"
                variant="B-collapsed"
                state="populated"
                width={360}
                controller={controller}
              />
            )}
            <Frame
              id={`${id}-clean`}
              variant={id}
              state="clean"
              width={360}
              controller={controller}
            />
            <Frame
              id={`${id}-error`}
              variant={id}
              state="error"
              width={360}
              controller={controller}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
