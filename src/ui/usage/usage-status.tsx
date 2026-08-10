import type { UsageSnapshot } from "../../lib/usage-snapshot";
import { formatTokens, USAGE_AGENT_LABEL } from "./usage-format";

/**
 * The strip of things the screen has to admit: a cold scan in progress, a
 * source that is absent, a source that could not be read, lines the parser
 * skipped, and data that is no longer fresh.
 *
 * `missing` and `unreadable` deliberately produce different sentences in
 * different colours (spec major M7). "No data yet" and "we could not read it"
 * are opposite situations — one needs no action, the other is the user's
 * permissions or a broken file — and collapsing them into one grey line is
 * how a real failure gets read as an empty state and ignored.
 *
 * Copy discipline (spec §Goal): this is one OS user's history that still
 * exists on one machine. The words are "this machine" and "recorded history";
 * "machine-wide" and "all-time" are both wrong and both banned.
 *
 * Props rather than store reads: the five states are then testable without a
 * signal or a Tauri mock, and the screen stays the only place that knows
 * where the data comes from.
 */

interface UsageStatusProps {
  readonly snapshot: UsageSnapshot | null;
  readonly loading: boolean;
  readonly stale: boolean;
}

type NoteTone = "faint" | "muted" | "error";

interface StatusNote {
  readonly key: string;
  readonly text: string;
  readonly tone: NoteTone;
}

function buildNotes({
  snapshot,
  loading,
  stale,
}: UsageStatusProps): readonly StatusNote[] {
  const notes: StatusNote[] = [];

  // Only the COLD scan is announced. Once data is on screen the 5 s poll runs
  // silently — a line that appears and vanishes every five seconds is noise
  // over the numbers the user is actually reading.
  if (snapshot === null && loading) {
    notes.push({
      key: "loading",
      text: "reading this machine's recorded history…",
      tone: "muted",
    });
  }

  if (stale) {
    notes.push({
      key: "stale",
      text: "stale — showing the last good read",
      tone: "muted",
    });
  }

  for (const source of snapshot?.sources ?? []) {
    const agent = USAGE_AGENT_LABEL[source.agent];
    if (source.state === "unreadable") {
      notes.push({
        key: `source-${source.agent}`,
        text: `couldn't read ${agent} history on this machine`,
        tone: "error",
      });
    } else if (source.state === "missing") {
      notes.push({
        key: `source-${source.agent}`,
        text: `${agent}: no data yet`,
        tone: "faint",
      });
    }
  }

  const skipped = snapshot?.skippedLines ?? 0;
  if (skipped > 0) {
    notes.push({
      key: "skipped",
      text: `${formatTokens(skipped)} lines skipped`,
      tone: "faint",
    });
  }

  return notes;
}

export function UsageStatus(props: UsageStatusProps) {
  const notes = buildNotes(props);

  // The container is always in the tree so the live region exists before it
  // has anything to say; `.usage-status:empty` collapses it in CSS rather
  // than a conditional render that would keep re-creating the region.
  return (
    <div class="usage-status" role="status" aria-live="polite">
      {notes.map((note) => (
        <span
          key={note.key}
          class={`usage-status__note usage-status__note--${note.tone}`}
        >
          {note.text}
        </span>
      ))}
    </div>
  );
}
