/**
 * The manual order the user dragged the rail's project clusters into.
 *
 * Design: `docs/specs/2026-08-22-rail-workspace-reorder-design.md` `decided`.
 * Pure, for the same reason `agent-rail-model.ts` is: every precedence
 * decision here is invisible in a screenshot, and the component only renders
 * what the model returns.
 *
 * Two things this module is deliberately NOT about:
 *
 * - **Tabs.** The rail and the tab strip share one order key by contract
 *   ([`strip-order.ts`](../lib/strip-order.ts) `current`), and that contract
 *   is about tabs. The strip has no notion of a project cluster, so reordering
 *   clusters is invisible to it; no `openedAt` value is rewritten anywhere.
 * - **Tiers.** A PINNED project holds its slot whether or not it has tabs
 *   open, which is a deliberate break with "live work first, remembered
 *   after" (2026-08-20): the owner asked for a position, not a position
 *   within a tier. Unpinned clusters keep the boundary exactly.
 */
import type { RepositoryScan } from "../repositories/repository-client";
import type { RailStreamGroup } from "./agent-rail-model";

/**
 * The ceiling on the stored list. It grows by one entry per project ever
 * dragged and drops nothing on its own — an entry naming no visible project is
 * KEPT, since that is how a parked project returns to its slot — so it needs a
 * bound or a long-lived install accumulates every folder it has ever touched.
 */
export const MAX_RAIL_ORDER = 200;

/** The identity a folder git does not know answers to (spec §3). */
const PLAIN_PREFIX = "plain:";

/**
 * The repository key a stored entry means TODAY (spec §3.1).
 *
 * `rememberedClusters` reads the repository key out of the scan map, and that
 * map fills asynchronously after boot: before a history path's scan arrives
 * its cluster reports `plain:<path>`, afterwards the same cluster reports the
 * repository key. An entry written during that window would otherwise never
 * match again — two spellings for one project, and the position lost in
 * precisely the case this feature exists to serve.
 *
 * The rewrite only ever fires when git has SINCE answered for that path. Until
 * then `plain:<path>` is the project's identity and is correct.
 */
function canonicalEntry(entry: string, scans: ReadonlyMap<string, RepositoryScan>): string {
  if (!entry.startsWith(PLAIN_PREFIX)) {
    return entry;
  }
  const scan = scans.get(entry.slice(PLAIN_PREFIX.length));
  return scan !== undefined && scan.kind === "repository" ? scan.key : entry;
}

/**
 * Canonicalize on WRITE too, so the list converges instead of accumulating
 * both spellings: every `plain:<path>` the scan map can now resolve becomes
 * the repository key, and duplicates collapse to the first occurrence.
 */
function canonicalOrder(
  railOrder: readonly string[],
  scans: ReadonlyMap<string, RepositoryScan>,
): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of railOrder) {
    const key = canonicalEntry(entry, scans);
    if (key === "" || seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(key);
  }
  return next;
}

/**
 * Pinned clusters first, in the stored order; everything else after, in
 * exactly today's order (live clusters by open order, then remembered clusters
 * by history order). A project nobody has ever dragged behaves precisely as it
 * did before this module existed.
 *
 * Entries naming no present cluster are skipped silently — they are the memory
 * of a parked project, and the stored list is what keeps them.
 */
export function applyRailOrder(
  stream: readonly RailStreamGroup[],
  railOrder: readonly string[],
  scans: ReadonlyMap<string, RepositoryScan>,
): readonly RailStreamGroup[] {
  if (railOrder.length === 0) {
    // The identity path, and asserted as one: with no manual order the stream
    // must be the same array the model assembled, not a copy of it.
    return stream;
  }
  const byOrderKey = new Map<string, RailStreamGroup>();
  for (const group of stream) {
    // First writer wins, so one stored entry can only ever lift one cluster.
    if (!byOrderKey.has(group.orderKey)) {
      byOrderKey.set(group.orderKey, group);
    }
  }
  const pinned: RailStreamGroup[] = [];
  // Membership is by GROUP, not by key. Two clusters CAN share an `orderKey` —
  // `coveredHistoryPaths` in `agent-rail-model.ts` names the case: a history
  // entry whose scan resolves to a live cluster's repository key but which no
  // live worktree path is a prefix of builds its own remembered cluster under
  // that same key. Filtering the tail by key would then drop BOTH of them and
  // a project the user never touched would vanish off the rail; filtering by
  // identity lifts the first and leaves the second exactly where it was.
  const taken = new Set<RailStreamGroup>();
  for (const entry of railOrder) {
    const group = byOrderKey.get(canonicalEntry(entry, scans));
    if (group === undefined || taken.has(group)) {
      continue;
    }
    taken.add(group);
    pinned.push(group);
  }
  return [...pinned, ...stream.filter((group) => !taken.has(group))];
}

export interface RailPinInput {
  /** The stream AS DISPLAYED, top first — `applyRailOrder`'s own output. */
  readonly stream: readonly RailStreamGroup[];
  /** Index in `stream` of the cluster that was picked up. */
  readonly from: number;
  /** Index the cluster landed on, in the list it leaves behind when removed. */
  readonly to: number;
  readonly railOrder: readonly string[];
  readonly scans: ReadonlyMap<string, RepositoryScan>;
}

/**
 * The list one completed drop writes.
 *
 * A drop writes the dragged cluster's `orderKey` at the slot it landed in —
 * and pins every cluster ABOVE it that was not already pinned, in their
 * current order. Without that, a project dragged to slot 2 would be pushed
 * around by the open order of whatever sits in slot 1, which is the ordering
 * the user just overruled.
 *
 * Clusters BELOW the drop are deliberately not pinned: they are still in
 * today's order, and pinning them would freeze positions the user never
 * touched. Stored entries naming clusters below (or naming nothing at all —
 * a parked project) keep their relative order after the new prefix.
 */
export function pinAt(input: RailPinInput): readonly string[] {
  const { stream, from, to, railOrder, scans } = input;
  if (from < 0 || from >= stream.length || to < 0 || to >= stream.length || from === to) {
    // Dropped where it started, or a coordinate no cluster owns: nothing is
    // written, and the caller compares against the list it already holds.
    return canonicalOrder(railOrder, scans);
  }
  // A stored entry is an `orderKey`, and `applyRailOrder` resolves one to the
  // FIRST cluster carrying it — so a key that is not unique in the stream
  // cannot express a position at all. Two clusters CAN share one: a remembered
  // twin of a live repository, the case `applyRailOrder`'s own `taken` set
  // defends against. TWO different corruptions follow, and both are refused
  // rather than written wrong.
  //
  // The DRAGGED cluster's key must be unique. The controller resolves what was
  // grabbed by that key too, so on a twin it reports the first one's index and
  // the write would move the live cluster while the remembered one the user
  // actually dragged stays put.
  if (countKey(stream, stream[from].orderKey) > 1) {
    return canonicalOrder(railOrder, scans);
  }
  const moved = [...stream];
  const [dragged] = moved.splice(from, 1);
  moved.splice(to, 0, dragged);
  // Everything down to and including the dropped cluster becomes the pinned
  // prefix; the rest of the stored list follows in its own order.
  const prefix = moved.slice(0, to + 1).map((group) => group.orderKey);
  // And the PREFIX must be free of duplicates. `canonicalOrder` collapses a
  // repeated key to its first occurrence, which silently shortens the prefix:
  // dropping a project BELOW a twinned pair would write one entry where two
  // slots were spanned, and the dragged cluster would land above the insertion
  // line it was dropped on. The identity that would fix either case is the
  // tier-scoped `key`, which is precisely what §3 exists not to store.
  if (new Set(prefix).size !== prefix.length) {
    return canonicalOrder(railOrder, scans);
  }
  const next = canonicalOrder([...prefix, ...railOrder], scans);
  return next.length > MAX_RAIL_ORDER ? prune(next, stream) : next;
}

function countKey(stream: readonly RailStreamGroup[], orderKey: string): number {
  return stream.reduce((count, group) => (group.orderKey === orderKey ? count + 1 : count), 0);
}

/**
 * Bring an over-long list back under the cap by dropping, from the END,
 * entries naming no cluster on screen. Those are memories of parked projects,
 * and the oldest of them is the one worth losing first; a project the rail is
 * showing is never pruned, however far down the list it sits.
 *
 * The stream is the whole present set: a remembered cluster IS a
 * workspace-history entry, and a history path a live cluster already covers
 * folds under that live cluster's header rather than standing on its own.
 */
function prune(railOrder: readonly string[], stream: readonly RailStreamGroup[]): string[] {
  const present = new Set(stream.map((group) => group.orderKey));
  const kept = [...railOrder];
  for (let index = kept.length - 1; index >= 0; index -= 1) {
    if (kept.length <= MAX_RAIL_ORDER) {
      break;
    }
    if (!present.has(kept[index])) {
      kept.splice(index, 1);
    }
  }
  // Still over the cap means every remaining entry names a visible cluster —
  // more than `MAX_RAIL_ORDER` projects are on screen at once. Keeping them
  // all is the honest answer: dropping one would unpin a project the user is
  // looking at to satisfy a bound that exists for absent ones.
  return kept;
}

/**
 * True when two stored lists say the same thing, so a drop that changes
 * nothing writes nothing (spec §6).
 */
export function sameRailOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
