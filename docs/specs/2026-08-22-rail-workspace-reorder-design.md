# Reordering workspace clusters in the agent rail — design

Date: 2026-08-22
Status: `decided` (owner approved the shape in chat, 2026-08-22)
Scope: renderer + settings schema. Phase 1 only; cross-window drag is §11.

## 1. The problem

The rail's project clusters sit where their oldest tab put them
([`sortClusters`](../../src/ui/agent-rail-model.ts) `current`), and the
remembered tier below them sits in MRU order. Neither is something the user
can change. A project that matters every day can therefore sit fourth
because it was opened fourth, and a project the user deliberately parked at
the bottom climbs back to the top of the remembered tier the moment it is
touched.

The owner asked for one thing: **drag a workspace cluster to where it should
be, and have it stay there** — including across the transition where its last
tab closes and it becomes a remembered cluster.

## 2. What drags

**The project cluster, and nothing else.** The grab surface is the cluster
header; the whole block (header plus every tab row under it) moves as one.

Explicitly NOT draggable, on the owner's instruction (2026-08-22):

- a tab row inside a cluster,
- an agent pane row,
- a tab row from one cluster into another.

That exclusion is what keeps this design off the tab strip entirely. The
strip and the rail share one order key by contract
([`strip-order.ts`](../../src/lib/strip-order.ts) `current`: "a project cannot
sit in one place on the strip and another in the rail"), and that contract is
about TABS. The strip has no notion of a project cluster, so reordering
clusters is invisible to it and the shared-order rule is untouched. No
`openedAt` value is rewritten anywhere in this design.

Both tiers drag: a live cluster and a rowless remembered cluster are the same
handle and the same list.

## 3. Cluster identity must outlive the tier

This is the load-bearing decision. `RailStreamGroup.key` is NOT a stable
identity for a project:

- live: `scan.key` for a repository, else `plain:<workspacePath>`
  ([`buildRail`](../../src/repositories/repository-model.ts) `current`);
- remembered: `remembered:<that same key>`
  ([`rememberedClusters`](../../src/ui/agent-rail-model.ts) `current`).

So the key a live cluster is stored under is not the key it answers to after
its last tab closes. Persisting positions against `key` would lose the
position in exactly the case the owner named.

`RailStreamGroup` gains one field:

```ts
/**
 * Stable project identity across the live/remembered tiers — the repository
 * key, or `plain:<path>` for a folder git does not know. `key` carries a
 * tier prefix and therefore changes when the last tab closes; this does not.
 * The manual rail order is stored against this and nothing else.
 */
readonly orderKey: string;
```

It is produced, not derived by string-stripping: the live branch writes
`group.key`, the remembered branch writes the un-prefixed `key` it already
computes. A consumer never has to know the prefix exists.

Consequence carried on purpose: two worktrees of one repository fold into one
cluster already, so they share one `orderKey` and one position. A plain
folder outside git is identified by its path, so moving or renaming that
folder loses its position — accepted; there is no other identity to use.

### 3.1 `orderKey` is not stable until the scan lands

`rememberedClusters` reads the repository key out of `input.scans`, and that
map fills asynchronously after boot. Before a history path's scan arrives its
cluster reports `plain:<path>`; afterwards the same cluster reports the
repository key. Left alone that breaks the feature twice: a pinned project
would sit unpinned for the first frames and then jump, and a drag performed
before the scan lands would write `plain:<path>` while the live tier later
stores the repository key — two entries for one project, and the position
lost in precisely the case this design exists to serve.

Two rules close it, and they are the reason `applyRailOrder` takes the scan
map rather than the order list alone:

- **On read**, a `railOrder` entry matches a cluster if it equals the
  cluster's `orderKey` OR if it is `plain:<path>` for a path the scan map now
  resolves to that cluster's repository key.
- **On write**, every `plain:<path>` entry the scan map can now resolve is
  rewritten to the repository key, and duplicates collapse to the first
  occurrence. The list therefore canonicalizes itself as scans arrive instead
  of accumulating both spellings.

Until a folder's scan exists, `plain:<path>` IS its identity and is correct.
The rewrite only ever fires when git has since answered for that path.

## 4. The ordering rule

One new pure module, `src/ui/rail-order.ts`, with one exported function:

```ts
export function applyRailOrder(
  stream: readonly RailStreamGroup[],
  railOrder: readonly string[],
  scans: ReadonlyMap<string, RepositoryScan>,
): readonly RailStreamGroup[];
```

Rules, in order:

1. **Pinned clusters first.** Every cluster whose `orderKey` appears in
   `railOrder` is emitted in `railOrder`'s order.
2. **Unpinned clusters after**, in exactly today's order — live clusters by
   open order, then remembered clusters by history order. A project nobody has
   ever dragged behaves precisely as it does now.
3. `railOrder` entries naming no present cluster are skipped silently; they are
   the memory of a parked project and must survive being absent (§5).

**The live/remembered boundary does not apply to pinned clusters.** A pinned
project holds its slot whether or not it has tabs open. This is a deliberate
break with "live work first, remembered after" (2026-08-20) and it is the
whole point of the feature: the owner asked for a position, not a position
within a tier. Unpinned clusters keep the boundary.

`buildAgentRail` calls `applyRailOrder` as the last step over the stream it
already assembles. The model stays pure and keeps its injected clock; the
rail order arrives as `AgentRailInput.railOrder` (optional, defaulting to
empty, so every existing caller — gallery, tests — is unchanged).

## 5. Persistence

`Settings` gains:

```ts
/**
 * Project order the user dragged, by `RailStreamGroup.orderKey`, top first.
 * An entry naming no currently-visible project is KEPT — that is how a parked
 * project returns to its slot when it is reopened.
 */
railOrder: readonly string[];
```

Default `[]`. Validation mirrors `disabledAgents`: an array of non-empty
strings, deduplicated, anything else falls back to the default.

**Bound.** The list grows by one entry per project ever dragged and drops
nothing on its own, so it needs a ceiling. `MAX_RAIL_ORDER = 200`. On write,
if the list would exceed it, entries naming neither a live cluster nor a
workspace-history path are dropped from the END until it fits. Under the cap
nothing is ever pruned.

**Scope.** Settings are app-level, not window-scoped, so a drag in one window
reorders the rail in every window. Named rather than avoided: `sidebarWidth`
and `sidebarCollapsed` already behave this way, and a per-window project order
would mean the same project sits in two places on two screens with nothing to
explain why.

**Write timing.** One write per completed drop, never during the drag.

## 6. Interaction

Pointer events with a 5px threshold, following the repo's existing drag idiom
([`new-pane-drag.ts`](../../src/ui/new-pane-drag.ts) `current`,
[`pane-drag.ts`](../../src/terminal/pane-drag.ts) `current`). NOT HTML5
drag-and-drop.

- The collapse toggle SHARES the surface. It carries folder + name + caret,
  which is nearly the whole header, so excluding it would leave nothing to
  grab. Below the threshold nothing is consumed and its `click` fires
  untouched; past the threshold the drag starts and the click is suppressed —
  the `new-pane-drag.ts` bargain exactly.
- The two small controls are excluded outright: a press landing on the
  header's `+` (DL-27.18) or on a remembered cluster's remove control never
  starts a drag.
- The drag ghost and the insertion line are children of `document.body`, for
  the reason both existing controllers give: a re-render mid-drag replaces the
  rail's children and would otherwise wipe them.
- The ghost is the cluster header's label; the whole block is not cloned.
- One insertion line between clusters marks the drop slot. A collapsed cluster
  drags exactly like an expanded one.
- Near the top or bottom edge of `.asr-rail__list` the list auto-scrolls while
  a drag is held.
- Escape cancels; the drop is abandoned and nothing is written.
- Dropping a cluster back where it started writes nothing.

**Dropping pins.** A drop writes the dragged cluster's `orderKey` into
`railOrder` at the slot it landed in, and — because a pinned cluster must not
be reordered by an unpinned neighbour appearing later — also pins every
cluster ABOVE it that was not already pinned, in their current order. Without
that, a project dragged to slot 2 would be pushed around by the open order of
whatever sits in slot 1.

## 7. Design language

One new rule in `docs/DESIGN-LANGUAGE.md` §27:

> **DL-27.20.** A project cluster header is a drag handle for the whole
> cluster. No handle glyph is added: the header itself is the grab surface,
> and the drag is announced by the ghost and the insertion line rather than by
> resting chrome. The insertion line is `--hair-strong` at
> `--radius-flat`, full list width.

No handle icon on purpose — the owner has stripped resting chrome off this
rail four times; a permanently visible grip would be the fifth thing to
remove.

## 8. Files

| File | Change |
| --- | --- |
| `src/ui/rail-order.ts` | NEW — `applyRailOrder`, `pinAt`, `MAX_RAIL_ORDER`; pure |
| `src/ui/agent-rail-model.ts` | `RailStreamGroup.orderKey`; `AgentRailInput.railOrder`; apply as the last step |
| `src/ui/agent-rail.tsx` | drag controller on the cluster header, insertion line, settings write |
| `src/ui/rail-cluster-drag.ts` | NEW — the pointer controller, mirroring `new-pane-drag.ts`'s deps shape |
| `src/settings/settings-schema.ts` | `railOrder` field, default, validation |
| `src/styles/04a-agent-rail.css` | dragging state, ghost, insertion line |
| `docs/DESIGN-LANGUAGE.md` | DL-27.20 + ledger entry |

No R4 seam moves. `TabManager`, the tab strip, `open-sequence.ts`,
`strip-order.ts`, the coordinator and every IPC channel are untouched.

## 9. Testing

- `rail-order.test.ts` — pinned order wins; unpinned keep today's order;
  unknown entries survive; a project pinned while live keeps its slot when it
  becomes remembered (the owner's case, asserted directly); cap pruning; a
  `plain:<path>` entry still matches once the scan resolves that path to a
  repository key, and the write canonicalizes it without duplicating (§3.1).
- `agent-rail-model.test.ts` — `orderKey` is tier-independent for the same
  project; `railOrder` absent leaves the stream byte-identical to today.
- `rail-cluster-drag.test.ts` — threshold, Escape, drop-in-place writes
  nothing, a press on the `+` starts no drag.
- `settings-schema.test.ts` — default, validation, dedup, garbage rejected.
- `agent-rail.test.tsx` — a drop calls the settings write once with the
  expected list.

Gates before any completion claim: `npm test`, `npm run build`,
`npx tsc --noEmit`, and the design-language gate.

## 10. Unverified at design time

A native `npm run electron:dev` pass and an owner eye review are owed and are
NOT satisfied by the gates above. Renderer-only, so the change reaches BOTH
hosts; behaviour under `npm run tauri dev` is unverified.

## 11. Out of scope

- **Dragging a cluster into another Deck window** (the owner's phase 2). It
  needs its own spec: the transfer transaction
  ([`electron/coordinator.ts`](../../electron/coordinator.ts) `current`) moves
  ONE pane and materializes it as a fresh tab, so a project is N chained
  transactions with partial-failure semantics that do not exist yet. It is on
  the fork list twice over (PTY ownership, tab materialization).
- Reordering tab rows or pane rows — excluded by the owner.
- A keyboard equivalent for reordering. Named as a gap: today the order can
  only be changed with a pointer.
