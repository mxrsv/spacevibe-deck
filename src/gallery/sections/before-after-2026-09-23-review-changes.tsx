import { Fragment } from "preact";
import { GitBranch, GitDiff, X } from "@phosphor-icons/react";
import { CHROME_ICON, DeckIcon, FEATURE_ICON } from "../../ui/controls/deck-icon";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { DockTabs } from "../../ui/dock/dock-tabs";
import { DockToggle } from "../../ui/dock/dock-toggle";
import { DOCK_TABS, type DockTabDescriptor, type DockTabId } from "../../ui/dock/dock-tab-registry";
import { NOOP } from "../chrome-fixtures";

/**
 * The Changes candidate, drawn: Deck has no git status and no diff surface
 * (`docs/internals/agent-rail.md` — "No `git status` is run anywhere"), so
 * everything below the dock header is gallery markup in the app's tokens.
 * The header itself is the shipped `DockTabs` / `DockToggle` with a fourth
 * chip appended, so the column reads as the dock the user already knows.
 */

type FileStatus = "M" | "A" | "D";

interface ChangedFile {
  readonly path: string;
  readonly status: FileStatus;
  readonly added: number;
  readonly removed: number;
}

/** Six files, +120 −34 — the totals the card's diff stat prints. */
export const CHANGED_FILES: readonly ChangedFile[] = [
  { path: "src/lib/api-client.ts", status: "M", added: 48, removed: 21 },
  { path: "src/lib/api-client.test.ts", status: "A", added: 52, removed: 0 },
  { path: "src/lib/fetch-retry.ts", status: "M", added: 9, removed: 6 },
  { path: "src/ui/usage/overview-section.tsx", status: "M", added: 7, removed: 4 },
  { path: "docs/internals/overview.md", status: "M", added: 4, removed: 0 },
  { path: "src/lib/legacy-client.ts", status: "D", added: 0, removed: 3 },
];

const TOTAL_ADDED = CHANGED_FILES.reduce((sum, file) => sum + file.added, 0);
const TOTAL_REMOVED = CHANGED_FILES.reduce((sum, file) => sum + file.removed, 0);

/** `+120 −34`, in the card's meta line and the panel's summary; the file count is the tooltip. */
export function DiffStat({ interactive = false }: { readonly interactive?: boolean }) {
  const files = `${CHANGED_FILES.length} files changed`;
  const body = (
    <>
      <span class="ba23-stat__add">+{TOTAL_ADDED}</span>
      <span class="ba23-stat__del">−{TOTAL_REMOVED}</span>
    </>
  );
  return interactive ? (
    <button type="button" class="ba23-stat" title={`${files} — open Changes`} aria-label={`${files}, +${TOTAL_ADDED} −${TOTAL_REMOVED}. Open Changes`}>
      {body}
    </button>
  ) : (
    <span class="ba23-stat" title={files}>
      {body}
    </span>
  );
}

const CHANGES_TAB: DockTabDescriptor = {
  id: "changes" as DockTabId,
  label: "Changes",
  icon: GitDiff,
  // No action owns a Changes chord yet; the tooltip borrows the explorer's.
  action: "toggle-explorer",
};
const TABS: readonly DockTabDescriptor[] = [...DOCK_TABS, CHANGES_TAB];

type DiffLine =
  | { readonly kind: "hunk"; readonly text: string }
  | {
      readonly kind: "ctx" | "add" | "del";
      readonly old?: number;
      readonly next?: number;
      readonly text: string;
      readonly comment?: boolean;
    };

const DIFF: readonly DiffLine[] = [
  { kind: "hunk", text: "@@ -12,14 +12,19 @@ export function createApiClient(" },
  { kind: "ctx", old: 12, next: 12, text: "  const base = config.baseUrl;" },
  { kind: "del", old: 13, text: "  const retries = 3;" },
  { kind: "del", old: 14, text: "  let attempt = 0;" },
  { kind: "add", next: 13, text: "  const retries = 5;", comment: true },
  { kind: "add", next: 14, text: "  const retry = createRetry({ retries, backoffMs: 200 });" },
  { kind: "ctx", old: 15, next: 15, text: "" },
  { kind: "ctx", old: 16, next: 16, text: "  async function request(path: string) {" },
  { kind: "del", old: 17, text: "    while (attempt < retries) {" },
  { kind: "del", old: 18, text: "      attempt += 1;" },
  { kind: "add", next: 17, text: "    return retry(async () => {" },
  { kind: "add", next: 18, text: "      const response = await fetch(`${base}${path}`);" },
  { kind: "add", next: 19, text: "      if (!response.ok) throw new HttpError(response);" },
  { kind: "add", next: 20, text: "      return response.json();" },
  { kind: "add", next: 21, text: "    });" },
  { kind: "ctx", old: 19, next: 22, text: "  }" },
];

const STATUS_WORD: Readonly<Record<FileStatus, string>> = { M: "Modified", A: "Added", D: "Deleted" };

function FileRow({ file, selected }: { readonly file: ChangedFile; readonly selected: boolean }) {
  const slash = file.path.lastIndexOf("/");
  return (
    <button
      type="button"
      class="ba23-changes__file"
      data-selected={selected}
      data-status={file.status}
      title={`${STATUS_WORD[file.status]} · ${file.path}`}
    >
      <span class="ba23-changes__status" data-status={file.status} aria-label={STATUS_WORD[file.status]} />
      <span class="ba23-changes__path">
        <span class="ba23-changes__name">{file.path.slice(slash + 1)}</span>
        <span class="ba23-changes__dir">{file.path.slice(0, slash)}</span>
      </span>
      <span class="ba23-changes__count">
        {file.added > 0 && <span class="ba23-stat__add">+{file.added}</span>}
        {file.removed > 0 && <span class="ba23-stat__del">−{file.removed}</span>}
      </span>
    </button>
  );
}

function CommentBox() {
  return (
    <div class="ba23-comment" role="group" aria-label="Comment on line 13">
      <div class="ba23-comment__text">
        Keep the retry budget in config, not a literal. Read it from
        <code>settings.network.retries</code>.
      </div>
      <div class="ba23-comment__bar">
        <button type="button" class="btn ba23-comment__cancel" aria-label="Discard comment" title="Discard (Esc)">
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
        <button
          type="button"
          class="btn btn--primary ba23-comment__send"
          title="Paste into Claude's prompt with the file and line"
        >
          <AgentGlyph agent="claude" className="ba23-comment__glyph" />
          Send
          <kbd>⌘↵</kbd>
        </button>
      </div>
    </div>
  );
}

function DiffView() {
  return (
    <div class="ba23-diff" role="table" aria-label="Diff of src/lib/api-client.ts">
      <div class="ba23-diff__head">
        <span class="ba23-diff__file">src/lib/api-client.ts</span>
        <span class="ba23-changes__count">
          <span class="ba23-stat__add">+48</span>
          <span class="ba23-stat__del">−21</span>
        </span>
      </div>
      {DIFF.map((line, index) =>
        line.kind === "hunk" ? (
          <div key={index} class="ba23-diff__hunk">
            {line.text}
          </div>
        ) : (
          <Fragment key={index}>
            <div
              class="ba23-diff__line"
              data-kind={line.kind}
              data-commented={line.comment === true}
            >
              <span class="ba23-diff__num">{line.old ?? ""}</span>
              <span class="ba23-diff__num">{line.next ?? ""}</span>
              <span class="ba23-diff__sign">
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
              </span>
              <span class="ba23-diff__code">{line.text}</span>
            </div>
            {line.comment === true && <CommentBox />}
          </Fragment>
        ),
      )}
    </div>
  );
}

/** The dock column with Changes selected: summary, file list, one file's diff. */
export function ChangesDock() {
  return (
    <aside class="dock-panel is-open ba23-review__dock" aria-label="Changes (candidate)">
      <div class="dock-panel__header">
        <DockTabs items={TABS} active={"changes" as DockTabId} onSelect={NOOP} />
        <DockToggle open size={FEATURE_ICON} onToggle={NOOP} />
      </div>
      <div class="dock-panel__body ba23-changes">
        <div class="ba23-changes__summary">
          <div class="ba23-changes__where">
            <DeckIcon icon={GitBranch} size={CHROME_ICON} />
            <span class="ba23-changes__branch">feat/api-client</span>
            <DiffStat />
          </div>
          <div class="ba23-segment" role="radiogroup" aria-label="Compare against">
            <button type="button" role="radio" aria-checked="true" title="Uncommitted changes">
              Local
            </button>
            <button type="button" role="radio" aria-checked="false" title="Everything since main">
              main
            </button>
          </div>
        </div>
        <div class="ba23-changes__files" role="list">
          {CHANGED_FILES.map((file, index) => (
            <FileRow key={file.path} file={file} selected={index === 0} />
          ))}
        </div>
        <DiffView />
      </div>
    </aside>
  );
}
