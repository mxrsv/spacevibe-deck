/**
 * What the Changes list prints, derived from a reply — pure, so the view stays
 * a layout (plan 2026-10-10-changes-list, C6, C9).
 */
import type {
  ChangeEntry,
  ChangesFailure,
  ChangesSnapshot,
  ChangeStatus,
} from "../../host/git-changes-host";

/** One short mark per status; the word travels in the tooltip (C9). */
export const STATUS_MARK: Readonly<Record<ChangeStatus, string>> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

export const STATUS_WORD: Readonly<Record<ChangeStatus, string>> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  untracked: "Untracked",
};

export function baseName(entryPath: string): string {
  const slash = entryPath.lastIndexOf("/");
  return slash === -1 ? entryPath : entryPath.slice(slash + 1);
}

export function dirName(entryPath: string): string {
  const slash = entryPath.lastIndexOf("/");
  return slash === -1 ? "" : entryPath.slice(0, slash);
}

/** The absolute path a file channel takes, in the root's own separator. */
export function absolutePath(root: string, entryPath: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const trimmed = root.endsWith(separator) ? root.slice(0, -1) : root;
  return `${trimmed}${separator}${entryPath.split("/").join(separator)}`;
}

/** `+12 −3`, tabular and neutral (DL-4.2). */
export function countsLabel(entry: Pick<ChangeEntry, "added" | "removed">): string {
  return `+${entry.added} −${entry.removed}`;
}

export type CountsView =
  | { readonly kind: "binary" }
  | { readonly kind: "uncounted" }
  | { readonly kind: "counts"; readonly label: string };

export function countsFor(entry: ChangeEntry): CountsView {
  if (entry.binary) {
    return { kind: "binary" };
  }
  if (!entry.counted) {
    return { kind: "uncounted" };
  }
  return { kind: "counts", label: countsLabel(entry) };
}

export function entryTitle(entry: ChangeEntry): string {
  const word = STATUS_WORD[entry.status];
  if (entry.status === "renamed" && entry.oldPath !== null) {
    return `${word} from ${entry.oldPath} to ${entry.path}`;
  }
  return `${word}: ${entry.path}`;
}

/** The branch row's label: the branch, a detached commit, or an unborn branch. */
export function branchLabel(snapshot: ChangesSnapshot): string {
  if (snapshot.detached) {
    return snapshot.oid === null ? "Detached HEAD" : `Detached at ${snapshot.oid}`;
  }
  return snapshot.branch ?? "Unknown branch";
}

export function comparisonLabel(snapshot: ChangesSnapshot): string {
  return snapshot.initial
    ? "Uncommitted changes against the empty tree"
    : "Uncommitted changes against HEAD";
}

export function totalsLabel(snapshot: ChangesSnapshot): string {
  return `+${snapshot.totals.added} −${snapshot.totals.removed}`;
}

export function omittedLabel(omitted: number): string {
  return `${omitted} more ${omitted === 1 ? "change is" : "changes are"} not shown`;
}

/** The status-line text for a failure (DL-19.5); always the failure colour. */
export function failureLine(failure: ChangesFailure): string {
  return failure.message;
}
