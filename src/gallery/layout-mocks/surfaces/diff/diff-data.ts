import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import {
  AGENTS,
  AGENT_NAME,
  placeOf,
  spaceLabel,
  type MockAgent,
  type MockDiffLine,
  type MockFileChange,
  type MockState,
} from "../../layout-fixture";

export interface DiffRow extends MockDiffLine {
  /** Index across the whole file's hunks; selections are id ranges. */
  readonly id: number;
  readonly hunk: number;
}

export interface DiffHunk {
  readonly header: string;
  readonly rows: readonly DiffRow[];
}

export interface DiffFile {
  readonly change: MockFileChange;
  readonly rows: readonly DiffRow[];
  readonly hunks: readonly DiffHunk[];
}

export interface Range {
  readonly from: number;
  readonly to: number;
}

export interface Target {
  readonly agent: MockAgent;
  readonly label: string;
}

export interface Sent {
  readonly path: string;
  readonly range: Range;
  readonly payload: string;
  readonly delivery: string;
  readonly target: Target;
}

/** The files of the focused checkout that carry fixture hunks. */
export function diffFiles(agent: MockAgent): readonly DiffFile[] {
  return placeOf(agent)
    .checkout.changes.filter((change) => change.hunks !== undefined)
    .map((change) => {
      let id = 0;
      const hunks = (change.hunks ?? []).map((hunk, index) => ({
        header: hunk.header,
        rows: hunk.lines.map((line): DiffRow => ({ ...line, id: id++, hunk: index })),
      }));
      return { change, hunks, rows: hunks.flatMap((hunk) => hunk.rows) };
    });
}

const SEEDS: Readonly<
  Record<string, { readonly match: string; readonly length: number; readonly comment: string }>
> = {
  "src/auth/session-store.ts": {
    match: "response.status === 401",
    length: 3,
    comment: "Log the first 401 before retrying, so a loop shows up in the logs.",
  },
  "lib/leaderboard.ts": {
    match: "const curated",
    length: 2,
    comment: "Keep curated rows pinned even when their score is zero.",
  },
};

/** The range the composer opens on: a seeded one for the headline files, else the first additions. */
export function defaultRange(file: DiffFile): Range {
  const seed = SEEDS[file.change.path];
  const start = seed ? file.rows.findIndex((row) => row.text.includes(seed.match)) : -1;
  if (seed && start >= 0)
    return { from: file.rows[start].id, to: file.rows[start + seed.length - 1].id };
  const first = file.rows.findIndex((row) => row.kind === "add");
  const at = Math.max(first, 0);
  return { from: file.rows[at].id, to: file.rows[Math.min(at + 1, file.rows.length - 1)].id };
}

export function defaultComment(file: DiffFile): string {
  return SEEDS[file.change.path]?.comment ?? "";
}

export function rowsIn(file: DiffFile, range: Range | null): readonly DiffRow[] {
  if (!range) return [];
  return file.rows.filter((row) => row.id >= range.from && row.id <= range.to);
}

function span(numbers: readonly number[]): string {
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  return low === high ? `L${low}` : `L${low}-L${high}`;
}

/** DLC3: new-file numbers, old-file numbers for a deleted-only selection, with the suffix. */
export function locate(rows: readonly DiffRow[]): {
  readonly label: string;
  readonly suffix: string;
} {
  const deleted = rows.filter((row) => row.kind === "del");
  if (rows.length > 0 && deleted.length === rows.length) {
    return { label: span(deleted.map((row) => row.old ?? 0)), suffix: " (deleted lines)" };
  }
  const numbers = rows.flatMap((row) => (row.new === null ? [] : [row.new]));
  return {
    label: numbers.length ? span(numbers) : "L0",
    suffix: deleted.length > 0 ? " (across deletions and additions)" : "",
  };
}

export function payloadOf(file: DiffFile, range: Range | null, comment: string): string {
  const { label, suffix } = locate(rowsIn(file, range));
  return `In ${file.change.path}:${label}${suffix}: ${comment.trim()}`;
}

/** DLC6: the live agent panes of the diff's checkout. */
export function targetsFor(agent: MockAgent): readonly Target[] {
  const { checkout } = placeOf(agent);
  return AGENTS.filter(
    (item) => item.state !== "ended" && placeOf(item).checkout.id === checkout.id,
  ).map((item) => ({
    agent: item,
    label: `${AGENT_NAME[item.kind]} · ${spaceLabel(placeOf(item).space)}`,
  }));
}

const BUSY: Partial<Record<MockState, string>> = {
  working: "working",
  "needs-you": "waiting on you",
  failed: "failed",
};

/** DLC10: Enter follows only when the agent reads idle. */
export function deliveryOf(agent: MockAgent): string {
  const busy = BUSY[agent.state];
  return busy
    ? `Pasted, not sent: ${AGENT_NAME[agent.kind]} is ${busy}`
    : `Sent to ${AGENT_NAME[agent.kind]}`;
}

/** One review session over the focused checkout's files; every option drives the same state. */
/** `file` is the index the review opens on (default 0). */
export function useReview(
  agent: MockAgent,
  options: { readonly split?: boolean; readonly file?: number } = {},
) {
  const files = diffFiles(agent);
  const targets = targetsFor(agent);
  const start = files[options.file ?? 0] ? (options.file ?? 0) : 0;
  const fileIndex = useSignal(start);
  const range = useSignal<Range | null>(files[start] ? defaultRange(files[start]) : null);
  const composing = useSignal(files.length > 0);
  const text = useSignal(files[start] ? defaultComment(files[start]) : "");
  const targetId = useSignal(
    targets.find((item) => item.agent.id === agent.id)?.agent.id ?? targets[0]?.agent.id,
  );
  const split = useSignal(options.split ?? false);
  const sent = useSignal<readonly Sent[]>([]);
  const notice = useSignal<string | null>(null);
  const anchor = useRef(0);

  const file = files[Math.min(fileIndex.value, files.length - 1)];
  const target = targets.find((item) => item.agent.id === targetId.value) ?? targets[0];

  const openFile = (index: number) => {
    const next = files[index];
    if (!next) return;
    fileIndex.value = index;
    range.value = defaultRange(next);
    composing.value = false;
    text.value = "";
    notice.value = null;
  };
  const select = (id: number, extend: boolean) => {
    if (!extend || !range.value) anchor.current = id;
    range.value = { from: Math.min(anchor.current, id), to: Math.max(anchor.current, id) };
    notice.value = null;
  };
  const drag = (id: number) => {
    range.value = { from: Math.min(anchor.current, id), to: Math.max(anchor.current, id) };
  };
  const discard = () => {
    composing.value = false;
    text.value = "";
  };
  const send = () => {
    if (!file || !target || !range.value || text.value.trim() === "") return;
    const delivery = deliveryOf(target.agent);
    sent.value = [
      ...sent.value,
      {
        path: file.change.path,
        range: range.value,
        payload: payloadOf(file, range.value, text.value),
        delivery,
        target,
      },
    ];
    notice.value = delivery;
    discard();
  };

  return {
    files,
    file,
    targets,
    target,
    fileIndex,
    range,
    composing,
    text,
    split,
    sent,
    notice,
    setTarget: (id: string) => {
      targetId.value = id;
    },
    openFile,
    select,
    drag,
    discard,
    send,
    open: () => {
      if (range.value) composing.value = true;
    },
    payload: file ? payloadOf(file, range.value, text.value || "…") : "",
  };
}

export type Review = ReturnType<typeof useReview>;
