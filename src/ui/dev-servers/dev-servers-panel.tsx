import { FolderSimple, GitBranch } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "preact/hooks";
import type { DevServerSnapshot } from "../../dev-servers/dev-server-types";
import type { RepositoryScan } from "../../repositories/repository-client";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { LoadError } from "../controls/load-error";
import {
  runDevServerAction,
  type DevServerAction,
  type DevServerActionDeps,
  type DevServerFeedback,
} from "./dev-server-actions";
import { buildView, scanLine, type DevServerItem } from "./dev-server-model";
import {
  SCOPE_LABEL,
  SCOPES,
  type DevServerScope,
  type DevServerSubject,
} from "./dev-server-scope";
import { DevServerRow } from "./dev-server-row";

/**
 * The popover's body: scope row, one status line, then the servers. Everything
 * it draws arrives as props, so the same panel can be shown from fixtures.
 *
 * The scope resets each time the popover opens (DL-13.6) because this component
 * unmounts with it, and it starts at the active checkout — the rail's own focus.
 */

export interface DevServersPanelProps {
  readonly snapshot: DevServerSnapshot | null;
  /** The last scan or read failed, so what is listed may be out of date. */
  readonly failed: boolean;
  readonly subject: DevServerSubject;
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  readonly deps: DevServerActionDeps;
  onRetry(): void;
  /** An action completed and the popover should go (DL-13.2). */
  onDone(): void;
}

const MOVES: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]);

/** Arrow keys walk the action grid: ↑/↓ the same column of the next row, ←/→ along the row. */
export function walkGrid(event: KeyboardEvent): void {
  const target = event.target as HTMLElement;
  const rowEl = target.closest<HTMLElement>("[data-row]");
  if (!MOVES.has(event.key) || target.dataset.col === undefined || rowEl === null) {
    return;
  }
  const cells = (row: Element | undefined): HTMLElement[] =>
    row === undefined ? [] : Array.from(row.querySelectorAll<HTMLElement>("[data-col]"));
  const sideways = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
  let next: HTMLElement | undefined;
  if (sideways) {
    const row = cells(rowEl);
    next = row[row.indexOf(target) + step];
  } else {
    const rows = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-row]"),
    );
    const row = cells(rows[rows.indexOf(rowEl) + step]);
    next = row.find((cell) => cell.dataset.col === target.dataset.col) ?? row[row.length - 1];
  }
  if (next !== undefined) {
    event.preventDefault();
    next.focus();
  }
}

function emptyTitle(scanning: boolean, failed: boolean, scope: DevServerScope): string {
  if (scanning) {
    return "Looking for servers in your workspaces…";
  }
  return failed
    ? "Nothing to show until a scan succeeds."
    : `No dev servers found for ${SCOPE_LABEL[scope].toLowerCase()}.`;
}

export function DevServersPanel(props: DevServersPanelProps) {
  const { snapshot, failed, subject, scans, deps } = props;
  const [scope, setScope] = useState<DevServerScope>("worktree");
  const [stop, setStop] = useState("");
  const [feedback, setFeedback] = useState<DevServerFeedback | null>(null);
  const view = buildView(snapshot, scope, subject, scans, Date.now());
  const scanning = snapshot === null || snapshot.completeness === "pending";
  const firstCell = view.items[0] === undefined ? "" : `${view.items[0].id}:0`;
  const tabStop = view.items.some((item) => stop.startsWith(`${item.id}:`)) ? stop : firstCell;

  // `resolve` forces a scan and a probe, which can take seconds. A ref, not state, so a
  // second press in the same frame is already refused; `alive` drops a completion that
  // arrives after the popover closed, which must not close a reopened one.
  const pending = useRef(false);
  const alive = useRef(true);
  const [checking, setChecking] = useState(false);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const execute = async (item: DevServerItem, action: DevServerAction): Promise<void> => {
    let result: DevServerFeedback;
    try {
      result = await runDevServerAction(action, item, deps);
    } catch {
      result = { tone: "error", text: "Could not finish that — try again." };
    }
    pending.current = false;
    if (!alive.current) {
      return;
    }
    setChecking(false);
    setFeedback(result);
    if (result.tone === "ok" && action === "open-deck") {
      props.onDone();
    }
  };

  const run = (item: DevServerItem, action: DevServerAction): void => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setChecking(true);
    setFeedback(null);
    void execute(item, action);
  };

  return (
    <div class="dsv">
      <div class="dsv-head">
        <div class="dsv-scope">
          <DeckIcon icon={FolderSimple} size={ROW_ICON} class="dsv-scope__ico" />
          <span class="dsv-scope__name">{subject.name}</span>
          {subject.branch !== null && (
            <span class="dsv-scope__branch">
              <DeckIcon icon={GitBranch} size={ROW_ICON} />
              {subject.branch}
            </span>
          )}
          {/* DL-1.4: a native select behind a styled pill. */}
          <label class="dsv-select">
            <span class="dsv-sr">Show servers from</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.currentTarget.value as DevServerScope)}
            >
              {SCOPES.map((value) => (
                <option key={value} value={value}>
                  {SCOPE_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p
          class="dsv-status"
          role="status"
          data-tone={checking ? "idle" : (feedback?.tone ?? "idle")}
        >
          {checking
            ? "Checking…"
            : feedback !== null
              ? feedback.text
              : scanLine(snapshot, view, Date.now())}
        </p>
        {failed && (
          <LoadError message="Scan failed — readings may be out of date." onRetry={props.onRetry} />
        )}
      </div>
      {view.items.length === 0 ? (
        <div class="dsv-empty">
          <p class="dsv-empty__title">{emptyTitle(scanning, failed, scope)}</p>
          {!scanning && !failed && (
            <p class="dsv-empty__hint">
              Servers started from any terminal or editor appear here on their own.
            </p>
          )}
          {!scanning && !failed && scope !== "all" && view.hiddenElsewhere > 0 && (
            <button type="button" class="dsv-link" onClick={() => setScope("all")}>
              Show all projects ({view.hiddenElsewhere})
            </button>
          )}
        </div>
      ) : (
        <ul class="dsv-rows" onKeyDown={walkGrid}>
          {view.items.map((item, index) => (
            <DevServerRow
              key={item.id}
              item={item}
              rowIndex={index}
              stop={tabStop}
              onStop={setStop}
              onRun={run}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
