# Spec — Detach a pane into its own window

Status: core architecture decided 2026-08-10; implementation planning remains
gated by §15. This revision supersedes the first approved draft after a second
adversarial review found eight protocol blockers. The user approved the
behavior-preserving remediation: a move may fail safely rather than cut an
unsafe terminal stream, and a pane moved into an existing tab adopts that tab's
identity rather than overwriting it.

## 1. Problem

Deck runs several agent CLIs side by side, but every pane is trapped inside one
window. A long-running agent cannot be parked on a second monitor, and two panes
cannot be watched at full size at once. The window coordinator in
`src-tauri/src/coordinator.rs` was written for this feature and has been dormant
since: it maps pane → window, routes PTY events per window, and already exposes
`panes_for_window` for a future multi-window close path.

One pane moves to another window — a new one or an existing one — while its PTY
keeps running and its bounded visible history survives. A transfer is allowed
to fail and leave the source untouched; it is never allowed to claim success by
silently corrupting the terminal stream.

## 2. Decisions

### 2.1 Product forks resolved 2026-08-09

| Fork | Decision |
| --- | --- |
| Window shape | The detached window is a **full Deck window** booting with exactly one tab. Rejected: a minimal single-pane frame; auto-hiding chrome. |
| Scrollback | **Must survive within explicit bounds**, via `@xterm/addon-serialize`. Rejected: start blank; a full output replay subsystem in `pty.rs`. The dependency/bundle fork is approved. |
| Cross-window drag | **In v1.** Drag a pane to empty space to create a window; drag into another window to dock it. Rejected: menu-command only; whole-window drop only. |
| Window lifecycle | **All windows are peers.** Closing one guards and kills only its own panes; the last one to close quits the app. ⌘Q asks once across all windows. |

### 2.2 Protocol forks resolved after the second review

| Fork | Decision and reason |
| --- | --- |
| PTY serialization domain | Reopen the R4 PTY seam and give each pane a Rust stream actor. Output, write, resize, kill, exit and transfer transitions need one linearization domain; frontend queues and coordinator locks cannot provide it. |
| Snapshot boundary | Cut only at an acknowledged **restart-safe boundary**. If none arrives within 2 seconds, abort the move and leave the source pane usable. This changes only the new move action: failing safely is preferable to a successful-looking move that corrupts an agent TUI. |
| Boundary tracker | Port the small parser-state/action contract corresponding to pinned xterm 6 into Rust and lock it with differential tests. Do not read xterm private state in production and do not add a parser dependency. |
| No owner remains | If the source is gone and the destination cannot commit before the total deadline, kill the PTY and record `FailedNoOwner`; never leak a permanently backpressured process. |
| Bounds | 2 s to reach a safe boundary, 10 s total transfer time, 4 MB transfer journal, 10,000 scrollback lines and an 8 MB serialized snapshot cap. |
| Live-adopt metadata | A pane moved into an existing tab joins that tab. Source tab name, dot color and workspace move only in boot-adopt, where a new tab is created. |
| Settings and updater | Their multi-window authorities remain separate blocking work. This spec defines only their close/quit integration contracts; both must be complete before multi-window ships. |
| Transfer identity | Process-local monotonic Rust `u64` IDs plus a window-instance request key. `uuid` is unnecessary and is not an approved dependency. |
| Exit during transfer | Preserve the exit event in sequence, finish a valid transfer, then apply the destination's normal exited-pane policy. |

`@xterm/addon-serialize` remains the only newly approved runtime dependency.
There is no Rust dependency fork in this revision.

## 3. Goals and guarantees (v1)

- Move one pane into a new or existing Deck window without killing its PTY.
- Preserve its bounded visible terminal history, cwd and agent identity.
- Preserve tab name override, dot color and `workspacePath` for boot-adopt. A
  live-adopted pane deliberately takes the existing destination tab's identity.
- Assign every PTY event a monotonically increasing sequence and apply every
  sequence logically once, in order. Tauri transport itself is not claimed to
  be exactly-once.
- Select a source cutoff only after Rust has observed a restart-safe terminal
  boundary and the source xterm has acknowledged parsing through that cutoff.
- Never deliver post-cutoff events to the source after commit. An abort returns
  them to a still-live source in sequence.
- Make transfer retries return the already-recorded terminal outcome rather
  than executing a second transition.
- Keep every window independently closable and independently guarded.
- Make ⌘Q, close-last-window and OS exit requests converge on one app-wide quit
  transaction and at most one user prompt.
- Fail a move without changing the source layout when a safety precondition,
  bound or destination step cannot be satisfied.

The guarantee is ordered PTY-event continuity plus bounded visible-buffer
preservation. It is not a claim that `SerializeAddon` clones every private xterm
emulator field or that the destination is bit-identical at the object level.

## 4. Non-goals (later, not never)

- Moving a whole **tab** with all its panes. Panes only.
- Re-flowing a detached window's layout into the source on close.
- Session restore of a multi-window arrangement across app restarts.
- Cross-window drag of anything other than a pane.
- Full raw-output replay from session start.
- Exporting or importing xterm private parser objects.
- Patch-merge for every persisted store inside the pane-transfer transaction.
  Settings, presets, workspaces, logos and updater ownership are separate
  blocking work tracked in §15.
- Windows-specific native pointer capture if the §11.4 gate fails. That remains
  a fork to bring back to the user.

### 4.1 Build order inside v1 — not a scope cut

- **Phase A** — the multi-window foundation (§7–§10) plus a command that moves a
  pane to a new or existing window. This proves the transfer transaction under
  real use.
- **Phase B** — cross-window drag (§11), gated on Windows pointer capture,
  mixed-DPI evidence and the arbitration contract in §15.

Both phases are v1. Phase B is sequenced, not deferred.

## 5. Current source facts

The original source-fact table was verified against `e62fe61`; the working tree
has since moved and must be refreshed again when the implementation plan is
written. The architectural facts below were rechecked during the blocker review.

| Fact | Where |
| --- | --- |
| `WindowCoordinator` is one `Mutex<HashMap<pane, label>>`. | `coordinator.rs:7-10` |
| `emit_to_owner` reads the owner and emits in two steps. | `coordinator.rs:60-70` |
| Missing ownership broadcasts the PTY event to every window. | `coordinator.rs:69-70` |
| PTY keeps no output history; the reader emits and forgets. | `pty.rs:352-430` |
| Output is decoded and batched independently of terminal control-sequence boundaries. | `pty.rs:352-400` |
| `Output`, `PromptReady` and `Exit` are distinct event kinds routed through the same owner map. | `pty.rs:243-253`, `:392-429` |
| Exit is emitted and then the ownership route is unregistered. | `pty.rs:417-429` |
| `write_pty`, `resize_pty` and `kill_pty` do not validate the calling window. | `pty.rs:440-499` |
| The frontend per-pane write chain covers normal xterm input and Prompt Board injection. | `pane-lifecycle.ts:69-112` |
| Agent launch and file drop bypass that write chain. | `agent-launch.ts:83-97`, `terminal-manager.ts:458-477` |
| `Pane.write` does not await xterm's parser callback. | `pane.ts:287-289` |
| `TerminalManager.dispose()` kills all panes it still knows. | `terminal-manager.ts:696-705` |
| `main()` initializes every persisted store before rendering `App`. | `main.tsx:12-25` |
| Every `App` creates window-local updater, quit and menu side effects. | `app.tsx:203-220`, `:300-383` |
| Menu and quit events are broadcast today. | `menu.rs:143-149`, `lib.rs:85-92` |
| `QuitState` is only an `AtomicBool confirmed`. | `lib.rs:17-25` |

## 6. Evidence and its limits

### 6.1 Pointer capture spike (2026-08-09)

The existing in-window pane drag uses Pointer Events and
`setPointerCapture`. A throwaway build measured whether capture survives outside
the native macOS window:

| Measurement | Run 1 | Run 2 |
| --- | --- | --- |
| `pointermove` delivered outside the window | 3 | **294** |
| Time spent outside | 27 ms | **6392 ms** |
| Farthest distance outside | 22 px | **1213 px** |
| Longest gap between outside moves | — | **96 ms** |
| `pointerup` delivered while outside | yes | yes (`clientX = -227`) |
| `pointercancel` | none | none |

Coordinate conversion had zero residual at two measured positions:

```text
clientX = screenX − innerPosition.x / scaleFactor
```

`innerPosition()` is physical pixels and `screenX` is CSS pixels. Evidence is
macOS-only, one display, `scaleFactor = 2`; it proves nothing about WebView2 or
mixed-DPI display crossings.

### 6.2 xterm serialization evidence

`SerializeAddon` walks the normal and alternate buffers and reconstructs text,
cell attributes, cursor position and selected modes. It does not serialize
parser continuation. A valid Rust output batch can end with the
first half of `ESC [ 31 m`, an OSC/DCS payload, or a Unicode base character
whose combining mark arrives in the next batch. `term.write(data, callback)`
proves that xterm processed `data`; it does not prove that the parser is in a
state from which a fresh xterm can consume the next bytes equivalently.

Therefore:

- `prepare_transfer` returning is not a webview delivery barrier.
- `flush() + SerializeAddon` is not a safe arbitrary cut.
- A tail replay beginning at an arbitrary byte can duplicate visible effects or
  begin inside a control sequence.
- The cut must be restart-safe before the snapshot is taken.

## 7. Transfer architecture

### 7.1 Two coordination domains

**`AppCoordinator`** owns small app metadata:

```rust
struct AppCoordinator {
    windows: HashMap<WindowLabel, WindowRecord>,
    panes: HashMap<PaneId, PaneHandle>,
    transfer_index: HashMap<TransferId, PaneHandle>,
    pending_boot_adoptions: HashMap<WindowLabel, TransferId>,
    quit: GlobalQuitState,
    next_window_id: u64,
    next_window_instance_id: u64,
    next_transfer_id: u64,
}
```

**One `PaneActor` per PTY** owns the serialization domain:

```rust
struct PaneRuntime {
    session: Session,
    route: PaneRoute,
    next_event_seq: u64,
    journal: VecDeque<PtyEventEnvelope>,
    restart_safety: RestartSafetyTracker,
    transfer: Option<TransferState>,
    outcomes: VecDeque<TransferTerminalOutcome>,
}
```

The PTY reader sends bytes into a bounded actor channel. All output sequencing,
write, resize, kill, EOF and transfer transitions run through that actor. This
is the per-pane linearization domain; a validate-then-act command outside it is
not sufficient.

`AppCoordinator` never stores PTY payloads or terminal snapshots. It finds the
right actor and makes app-level admission decisions, then releases its lock
before sending actor messages.

### 7.2 Identity and idempotent request keys

```rust
struct TransferId(u64);

struct ClientRequestKey {
    window_instance_id: u64,
    counter: u64,
}
```

Rust assigns a new `window_instance_id` at webview bootstrap. The frontend
increments `counter` for each operation. Repeating `begin_transfer` with the
same request key returns the same transfer ID. IDs are correlation values bound
to source and destination records, not bearer security capabilities.

### 7.3 Typed, sequenced PTY events

```rust
struct PtyEventEnvelope {
    pane_id: u32,
    seq: u64,
    event: PtyEvent,
}

enum PtyEvent {
    Output { data: String },
    PromptReady,
    Exit { reason: ExitReason },
}
```

The actor appends each envelope to the journal before attempting a targeted
push. Push is a latency optimization, not the source of truth. The destination
can recover missed events with `read_pty_events(pane_id, after_seq)`.

Journal access is role-bound in the same actor turn as the read or
acknowledgement:

- In `Owned`, only the current owner may read or acknowledge.
- While draining, the source may read and acknowledge events delivered to it.
- After a source cutoff exists, the source can read or acknowledge only through
  `source_cutoff`.
- The bound destination gains access only after claim and only to sequences
  above `source_cutoff` that the actor has returned or pushed to it.
- An acknowledgement cannot exceed the highest sequence made available to that
  caller in its current role. Unauthorized or over-high acknowledgements are
  errors and do not prune the journal or advance a transfer phase.

Each frontend pane owns a `PaneInbox`:

- `nextExpectedSeq` defines the only event eligible to apply.
- Lower sequences are duplicates and are ignored.
- Higher sequences wait until gaps are pulled from the journal.
- `Output` advances only from `term.write(data, callback)`.
- `PromptReady` and `Exit` advance only after their side effect is applied.
- `ack_pty_events(through_seq)` is cumulative and monotonic.

The guarantee is **logical exactly-once application**. Events may be pushed more
than once by transport and are deduplicated by sequence.

The shell-integration parser stays with the Rust session. Its own pending OSC
continuation is not transferred or reset.

### 7.4 Restart-safe boundary

`RestartSafetyTracker` consumes the same decoded output in the same actor order
as event sequencing. It is deliberately smaller than a terminal emulator: its
only contract is to answer whether a fresh pinned xterm can consume the next
event from a canonical continuation state.

A boundary is restart-safe only when:

```text
xterm_parser_state == GROUND
AND grapheme_continuation == CLEAN
```

The tracker mirrors xterm 6 parser transitions and the actions that clear or
retain Unicode grapheme continuation. It does not infer safety from Rust read
or Tauri event boundaries. Differential tests against pinned xterm are a hard
gate; an xterm upgrade cannot land until those tests prove parity again.

When transfer starts while unsafe, output continues to the source until the
first safe event boundary. If none arrives within 2 seconds, the actor aborts
the transfer before a cutoff is established. The pane and its stream remain at
the source.

After snapshot replay, destination writes one internal `NUL` through xterm's
parser before any post-cutoff event. For pinned xterm this is a no-op execute
that canonicalizes grapheme continuation without changing the visible buffer.
The differential suite must lock that behavior; if it stops holding, transfer
is blocked rather than silently weakened.

### 7.5 Operation gate and source cutoff acknowledgement

The source enters local `Freezing` before asking Rust to begin:

1. Disable pane-local injection, agent launch, file drop, clear, close and
   settings-induced fit/resize.
2. Await the shared per-pane frontend write chain.
3. Call `begin_transfer(request_key, pane_id, target)`.

Every frontend writer must use that shared queue. This removes bypasses, but the
Rust actor remains authoritative: `begin_transfer` is processed after every
actor operation already admitted before it. That actor transition is the write,
resize and kill cutoff. New operations return `TransferInProgress`; the source
UI holds user input until the move commits or aborts rather than dropping it.

The actor enters `DrainingToSafeBoundary`. It continues journaling and pushing
events to the source. At the first restart-safe boundary it records
`source_cutoff = current_seq`, stops pushing later events, and emits
`transfer:cut-ready { transfer_id, source_cutoff }`.

The source pulls and applies events through `source_cutoff`, then calls
`ack_transfer_cut`. The actor accepts that acknowledgement only when:

```text
caller == source
AND source_applied_seq >= source_cutoff
AND phase == AwaitingSourceCutAck(source_cutoff)
```

This accepted actor message is the delivery-and-parse barrier. A Tauri emit or
the return of `begin_transfer` is not the barrier. Only after the acknowledgement
returns may the source serialize xterm.

### 7.6 Transfer phases

```rust
enum PaneRoute {
    Owned { window: String },
    Transferring { transfer_id: TransferId },
    Terminated,
}

enum TransferPhase {
    DrainingToSafeBoundary,
    AwaitingSourceCutAck { source_cutoff: u64 },
    AwaitingPayload { source_cutoff: u64 },
    Ready { source_cutoff: u64 },
    Claimed { source_cutoff: u64 },
    ReplaySealed {
        source_cutoff: u64,
        replay_cutoff: u64,
    },
}
```

`TransferState` also records source, bound target, request key, start time and
source/destination liveness. A transition not listed in this state machine is a
typed error, not an inferred fallback.

### 7.7 Adoption payload and control plane

```rust
struct AdoptionPayload {
    schema_version: u16,
    pane_id: u32,
    source_cols: u16,
    source_rows: u16,
    serialized_terminal: String,
    history_truncated: bool,
    exited_at_cutoff: bool,
    cwd: Option<String>,
    process_snapshot: Option<ProcessSnapshot>,
    boot_tab: Option<BootTabMetadata>,
}

struct BootTabMetadata {
    name_override: Option<String>,
    dot_color: Option<String>,
    workspace_path: Option<String>,
}
```

The source stages serialized terminal state and boot-tab metadata in Rust with
`stage_transfer_payload`. Rust supplies authoritative cwd and process state from
the session and validates schema, UTF-8 byte size and target binding. A retry
with the same payload returns success; a different payload for the same phase
returns `PayloadConflict`.

For **boot-adopt**, Rust creates the new window only after payload staging,
binds its label and instance ID to the transfer, and records its boot mode. The
new window reads `window_boot_mode()` before any persisted store or updater is
initialized. It registers listeners, builds only the adoption shell and claims
the transfer.

For **live-adopt**, target window and placement are bound at begin. Rust sends a
small targeted `transfer:ready` notification after staging. The destination
also calls `pending_adoptions_for_window()` after listener registration, so a
missed notification cannot strand the transfer.

Only the bound destination can claim and read the payload. The payload is never
broadcast.

### 7.8 Claim, replay, seal and commit

The destination claims idempotently and receives the same payload on retry. It
then:

1. Builds a hidden pending `Pane`; it is not in the active layout and cannot
   write, resize or focus the PTY.
2. Initializes its `PaneInbox.appliedSeq = source_cutoff`.
3. Replays `serialized_terminal`, then the internal `NUL`, through xterm write
   callbacks.
4. Calls `seal_transfer_replay`.

The actor chooses `replay_cutoff = current_seq`, changes phase to
`ReplaySealed`, and returns journal events in
`(source_cutoff, replay_cutoff]`. Events after that cutoff remain journaled.
The destination applies the returned range in sequence and cumulatively
acknowledges `replay_cutoff`.

`commit_transfer(transfer_id, replay_cutoff)` succeeds only when:

```text
caller == bound_destination
AND phase == ReplaySealed(source_cutoff, replay_cutoff)
AND destination_applied_seq >= replay_cutoff
```

One actor transition is the commit linearization point. It also captures
`live_high_water = current_seq` so output sequenced after seal cannot be
stranded:

1. Record `TransferTerminalOutcome::Committed` in the pane actor ledger.
2. Change route to `Owned(destination)`.
3. Retarget and push every unacknowledged journal event with
   `seq > replay_cutoff` to the destination.
4. Target the committed outcome, including `live_high_water`, to source and
   destination.
5. Return the recorded outcome.

The destination keeps the pending pane hidden until it has pulled and applied
through `live_high_water`, even if no later push exposes a sequence gap. New
events have a higher sequence and target the destination. Its inbox exists
before commit, so push-before-command-response ordering is harmless. A lost
commit response is recovered from the same outcome and journal range.

### 7.9 Abort and source release

Before commit, abort returns ownership only when the source is still viable. It
records `Aborted`, retargets journal events after `source_cutoff` to the source,
and reopens the local operation gate after the source applies them. The source
never disposes its xterm during stage or claim, so abort requires no snapshot
reconstruction.

The source releases its pane only after a targeted committed outcome or a
`transfer_status` response proving `Committed`:

- Remove the leaf without `kill_pty`.
- Dispose the source xterm.
- Remove an empty tab and close an empty non-last window under §9.
- Call `ack_source_released`; source hard death after commit is implicit release.

Abort after commit cannot move ownership back. It returns the recorded
`Committed` outcome.

### 7.10 Bounds and backpressure

| Bound | Value | Behavior on breach |
| --- | --- | --- |
| Reach restart-safe boundary | 2 s | Abort before cutoff; source continues unchanged. |
| Complete transfer | 10 s from begin | Abort to a viable source; otherwise `FailedNoOwner` and kill PTY. |
| Unacknowledged pane journal | 4 MB UTF-8 bytes | Never drop. While `Owned`, stop draining the bounded reader channel until the owner acknowledges or is destroyed. During transfer, abort to a viable source; otherwise backpressure while the destination gets the remaining deadline, then kill on final no-owner failure. |
| Serialized history | Last 10,000 rows, 8 MB UTF-8 bytes | Reduce the addon row range from the top and reserialize. Never slice raw ANSI or a JavaScript string. If the minimum viewport still exceeds the cap, stage an empty snapshot with `history_truncated = true`; the live session still moves. |
| Outcome ledger | 1,024 outcomes or 10 minutes | Never evict active transfers. Expired lookup returns `OutcomeExpired` and performs no transition. |

Backpressure is bounded by the existing reader channel and the total deadline;
it is not a permanent orphan strategy.

### 7.11 Exit and typed ordering

Exit is the final typed journal event, not a side channel:

- Exit at or before source cutoff is reflected in `exited_at_cutoff`; destination
  does not synthesize a second exit notice.
- Exit after source cutoff is replayed in sequence with output and prompt-ready.
- EOF while the restart tracker is inside an incomplete sequence is terminally
  safe: no future byte can complete it. Visible state is serialized and the
  destination is marked exited.
- After commit, the destination applies its normal exited-pane policy. A
  multi-pane tab may remove the exited pane; a single-pane tab keeps the normal
  session-ended state.

Session cleanup does not unregister routing until the final event has reached a
terminal transfer outcome. A terminated pane keeps the route tombstone needed
for retries through the ledger lifetime.

### 7.12 Window death matrix

`CloseRequested` is a soft, preventable state; `Destroyed` is a hard fact. They
must not share one handler.

| Event | Terminal result |
| --- | --- |
| Source `CloseRequested` before payload staged | Abort to source, then include the pane in that window's close census. |
| Source `CloseRequested` after payload staged | Hold the window in `ClosingPendingTransfer` for the remaining transfer deadline. Commit makes source release implicit; abort returns the pane to the close census. |
| Source hard-destroyed before cut acknowledgement | No trustworthy snapshot exists: kill PTY, record failure, close a pending boot destination. |
| Source hard-destroyed after cut acknowledgement but before payload staged | Same: Rust does not possess the visible history payload. |
| Source hard-destroyed after payload staged | Continue only toward the bound destination; abort-to-source is disabled. |
| Destination closes or is destroyed before commit | Abort to a viable source; otherwise kill and record `FailedNoOwner`. |
| PTY exits in any transfer phase | Journal the final event and follow §7.11. |
| Either window dies after commit | Normal ownership and orphan rules apply. |
| Both windows enter close during transfer | Settle once; include the PTY in exactly one close/quit census. |
| Timeout with source viable | Abort to source. |
| Timeout without source | Kill PTY; never invent an owner. |

On hard `Destroyed(label)`, kill only panes still `Owned(label)`. A transferring
pane follows this table instead of being treated as owned by both windows.

### 7.13 Retry ledger

```rust
enum TransferTerminalOutcome {
    Committed {
        pane_id: u32,
        from: String,
        to: String,
        source_cutoff: u64,
        replay_cutoff: u64,
        live_high_water: u64,
        source_released: bool,
    },
    Aborted {
        pane_id: u32,
        owner: String,
        reason: AbortReason,
    },
    Failed {
        pane_id: u32,
        reason: FailureReason,
        pty_killed: bool,
    },
}
```

- Repeated begin with one request key returns one transfer ID.
- Repeated stage accepts only byte-identical validated payload.
- Repeated claim by the bound destination returns the same payload.
- Event acknowledgements only advance; older acknowledgements are no-ops.
- Repeated commit returns `Committed`.
- Abort after commit returns `Committed` without changing route.
- Commit after abort returns `Aborted`.
- Unknown or expired IDs return an error and perform no action.

The outcome is recorded in the actor before a terminal command reply. A lost
reply therefore changes retry latency, not state.

### 7.14 Lock and observability rules

- Never call Tauri emit, WebView APIs, filesystem, dialog, process termination
  or an actor wait while holding the `AppCoordinator` lock.
- No global app lock participates in the PTY output hot path.
- One pane transfer cannot block routing for another pane.
- Actor messages and cumulative acknowledgements are the linearization points;
  comments and tests name them explicitly.
- Every transition logs transfer ID, pane ID, source, destination, old/new phase,
  cutoffs, journal bytes, elapsed time and reason. Never log terminal content or
  serialized history.
- Safe-boundary timeout, sequence-gap recovery, duplicate command, cap
  backpressure, window death, commit, abort, outcome eviction, quit dedupe and
  orphan kill each have distinct structured events.

## 8. Owner validation and operation contract

`write_pty`, `resize_pty` and `kill_pty` take caller window identity and send an
actor message. Ownership validation and the operation happen in the same actor
turn:

- `Owned(window)` and caller matches → perform operation.
- `Transferring` → return `TransferInProgress`.
- Any other route → reject.

Frontend input, Prompt Board injection, agent launch and file drop all enter the
same per-pane queue. Close, clear, fit and settings-driven resize consult the
same local transfer gate. Rust remains authoritative because frontend teardown
can race or disappear.

User input arriving during the short freeze is held until terminal outcome:

- Commit: the source drops held input because focus and pane ownership moved;
  the UI never presents it as sent.
- Abort: held input is released through the source queue after journal catch-up.
- Source close: normal close semantics discard unsent local input.

No input is silently reported as successfully written after Rust rejected it.

## 9. Window lifecycle

### 9.1 Creation and boot mode

`open_pane_window` creates `deck-<n>` from a monotonic process-local counter,
hardens the webview on the main event-loop thread, binds its instance ID to the
staged transfer and widens `capabilities/default.json` to `main` and `deck-*`.

`main()` calls `window_boot_mode()` immediately after desktop-environment
initialization and before settings, presets, workspaces, logos, updater or
`App` side effects. Normal mode runs the existing bootstrap. Adopt mode installs
listeners, claims the bound transfer, and builds one pending tab without opening
the Board or spawning a shell.

### 9.2 Menu routing

`menu:action` targets the focused window. With no focused window, Rust targets
the most-recently-focused live window. Pane-scoped actions are dropped if none
exists. Quit never uses this fallback path; it enters §9.3 directly.

### 9.3 Global quit state machine

```rust
enum GlobalQuitState {
    Idle,
    Inspecting { request_id: u64, initiator: QuitInitiator },
    AwaitingDecision {
        request_id: u64,
        presenter: String,
        census: QuitCensus,
    },
    Quiescing { request_id: u64 },
    Flushing {
        request_id: u64,
        pending_windows: HashSet<String>,
    },
    Terminating { request_id: u64 },
    Exiting,
}
```

The first `Idle → Inspecting` transition is the admission linearization point:

- Block new windows, pane spawns and transfers.
- Deduplicate repeated ⌘Q, menu quit, `RunEvent::ExitRequested` and
  close-last-window into the same request ID.
- Settle active transfers under §7.12, bounded by their existing deadline.
- Build one Rust census in which every live PTY appears exactly once.

If no pane is busy, advance directly to `Quiescing`. Otherwise select the
focused live window, then MRU live window, and send one targeted
`quit:prompt { request_id, census }`.

Only the selected presenter can call
`resolve_global_quit(request_id, decision)`. Duplicate and stale responses are
no-ops with logs.

**Cancel** transitions back to `Idle`, reopens admissions and returns any soft
close states to `Open`. Transfer outcomes that settled while Rust built the
census remain terminal and are never rolled back.

**Confirm** follows explicit one-way transitions:

1. `AwaitingDecision → Quiescing`: gate ordinary pane operations and freeze the
   final census.
2. `Quiescing → Flushing`: ask every live window to flush pending persisted
   state with the same request ID.
3. `Flushing → Terminating`: after all acknowledgements or a bounded timeout,
   log failures and kill every PTY in the frozen census exactly once.
4. `Terminating → Exiting`: set exit authorization only after actor termination
   has settled.
5. In `Exiting`, call `app.exit(0)`; only this state permits
   `RunEvent::ExitRequested` to leave the process.

Flush errors do not revoke explicit user consent.

If the presenter dies while awaiting a decision, Rust reissues the same request
to the next MRU live window. If no window remains but PTYs do, there is no UI in
which to ask; Rust kills the orphan sessions and exits. A repeated quit request
never opens a second dialog.

Updater install/relaunch and user quit share one app-exit admission gate. One
must finish or reject before the other can enter `Quiescing`.

### 9.4 Per-window close state machine

```rust
enum WindowLifecycle {
    Open,
    CloseInspecting { request_id: u64 },
    AwaitingCloseDecision { request_id: u64 },
    ClosingPendingTransfer { request_id: u64 },
    Closing,
    Destroyed,
}
```

`CloseRequested` is prevented while Rust:

1. Blocks new panes and transfers from that window.
2. Settles transfers involving it under §7.12.
3. Builds a census of panes ultimately owned by that window only.
4. Runs one busy guard.
5. On confirm, kills that census and issues one authorized native close.

Cancel returns the window to `Open`. Closing the last tab enters this same flow.
Closing the last window joins the global quit state machine instead of opening a
second dialog. A hard `Destroyed` skips user interaction and applies the orphan
rules.

### 9.5 Shared-state integration boundary

Multi-window settings consistency and updater operation ownership are separate
blocking majors, not hidden inside transfer or quit:

- Settings needs one write authority, revisions and collection conflict
  semantics. Frontend plugin-store caches cannot remain competing writers.
- Presets, workspaces and logo maps need either operation patches, revision
  rejection or live snapshot synchronization; “last write wins in the same
  second” is not an accurate bound on stale-window loss.
- Updater needs one app-wide operation owner, state fan-out and an app-wide busy
  guard before install/relaunch.

Their designs must expose `flush(request_id)` and app-exit admission to §9.3.
Multi-window cannot ship until those contracts are implemented and verified.

## 10. State contract for adoption

### 10.1 Boot-adopt

- Creates a new full Deck window with one tab.
- Moves pane ID, bounded serialized history, cwd, agent identity, source
  geometry, name override, dot color and `workspacePath`.
- Resets unread, attention/activity history, selection, zoom and focus-expand.
- Re-fits only after commit; no pre-commit PTY resize is allowed.

### 10.2 Live-adopt

- Inserts a hidden pending pane at the bound edge of the destination's active
  tab, then reveals it only after commit.
- Moves pane ID, bounded serialized history, cwd, agent identity and source
  geometry.
- Keeps the destination tab's name, dot color and workspace.
- Resets the same pane-local UI state as boot-adopt.

### 10.3 Source layout after commit

Detach does not call `closePane`, which may respawn a shell. Source release:

1. Removes the pane leaf and disposes xterm without `kill_pty`.
2. Removes an empty tab.
3. Opens the Board only when this is the sole remaining empty window.
4. Otherwise closes an empty source window through §9.4.

Before commit the source layout is unchanged. Every failure therefore leaves a
usable pane in place unless the explicit no-owner policy had to kill its PTY.

## 11. Cross-window drag (Phase B)

### 11.1 Protocol

Pointer capture stays with the source. Coordinates are relayed:

1. Source emits throttled screen-coordinate samples after leaving its bounds.
2. Each destination converts with its own live scale factor, hit-tests with
   `dropTargetAt` / `edgeFor`, and draws its local overlay.
3. Pointerup resolves one final destination and placement.
4. Source starts the §7 transaction bound to that target. The source layout does
   not change until committed outcome.
5. Drop outside every Deck window requests boot-adopt at that screen point.

An external detach is allowed when the source tab has only one pane; the current
`paneCount() < 2` guard applies only to in-window rearrangement.

### 11.2 Focus

The destination is not raised during drag. Calling `setFocus` can break source
pointer capture. A fully occluded destination may draw an overlay the user
cannot see; final target arbitration remains a §15 gate.

### 11.3 Multi-monitor gate

Before Phase B code, repeat the coordinate spike across displays with different
scale factors, including negative coordinates and moving/scaling destination
windows. Bounds and scale factor refresh on move, resize and scale change.

### 11.4 Windows gate

Before Phase B code, repeat the pointer-capture spike on WebView2. If capture
fails outside the native window, stop and bring the fork back to the user:
native Rust capture, removing drag from Windows v1, or platform-asymmetric
menu-command parity. This spec does not pre-decide it.

## 12. Module boundaries

| Module | Responsibility |
| --- | --- |
| `src-tauri/src/pane_stream.rs` | Per-pane actor, PTY event sequencing, restart-safety tracker, operation gate and journal. |
| `src-tauri/src/transfer.rs` | Transfer phases, payload validation, outcomes and bounds. |
| `src-tauri/src/coordinator.rs` | Small app index of windows, pane handles, transfer IDs and boot adoptions; no PTY hot-path payloads. |
| `src-tauri/src/quit.rs` | Global quit and per-window close state machines. |
| `src-tauri/src/pty.rs` | Spawn/command boundary and actor wiring; no second ownership model. |
| `src/terminal/pane-inbox.ts` | Sequence application, gap recovery and cumulative acknowledgements. |
| `src/terminal/pane-detach.ts` | Source freeze, cutoff acknowledgement, serialization, staging and outcome release. |
| `src/terminal/pane-adopt.ts` | Hidden pending pane, snapshot replay, seal, catch-up and commit. |
| `src/terminal/window-drag.ts` | Cross-window coordinate relay and final-target protocol. |
| `src/terminal/window-registry.ts` | Live bounds, scale factors, focus/MRU identity and placement data. |

The implementation plan may rename modules, but it may not collapse app-global
locks, per-pane stream state and frontend inbox state into one coordinator
mutex or one oversized frontend manager.

## 13. Error contract

Transfer errors are outcome-driven, not “any error means abort”:

- `SafeBoundaryTimeout` → source unchanged; move reports that terminal output
  could not reach a safe handoff point.
- `PayloadTooLarge` → source reserializes a smaller row range; minimum viewport
  overflow stages empty history with a truncation notice.
- `PayloadConflict` → reject retry and query transfer status.
- `SequenceGap` → pull journal and resume; never guess past the gap.
- `TargetGone` → abort to viable source; otherwise explicit no-owner failure.
- Lost command reply → query/retry by transfer ID; terminal ledger outcome wins.
- `OutcomeExpired` → perform no transition and show a recoverable diagnostic.
- Serialization failure → stage empty history with notice, preserving the live
  session. This is a visible-history degradation, not byte-stream loss.
- `FailedNoOwner` → PTY was killed because no live owner could complete or
  receive an abort; surface this distinctly from a normal session exit.

A destination pending pane is never exposed as active before commit. Any abort
disposes it without `kill_pty`.

## 14. Verification gates

### 14.1 Rust deterministic tests

- Every legal and illegal transfer-state transition.
- Linearization races: write/resize/kill/begin in every ordering.
- Typed ordering across output, prompt-ready and exit.
- Actor journal recovery after push loss, duplication and reordering.
- Source and destination close/destroy at every transfer phase.
- Retry every command before and after each terminal outcome.
- Safe-boundary timeout, total timeout, journal cap, backpressure and no-owner
  kill.
- No app-global lock held across emit, actor wait, dialog, filesystem or process
  termination.
- Global quit: repeated requests, stale decisions, presenter death, cancel,
  flush timeout, last-window close and updater-exit exclusion.

### 14.2 Differential xterm contract tests

Against pinned xterm 6:

- Every C0/C1 control and parser transition used by the tracker.
- CSI, OSC and DCS split at every byte boundary.
- Randomized chunk boundaries over recorded real agent output.
- Unicode base/combining/ZWJ sequences split across writes.
- Restart-safe decisions agree with xterm parser and grapheme continuation.
- Snapshot replay plus internal `NUL` leaves canonical clean continuation.
- An xterm version bump fails until parity is re-proven.

Private xterm state is permitted only in this test harness, not production code.

### 14.3 TypeScript tests

- `PaneInbox` gap, duplicate, reorder and cumulative-ack behavior.
- Freeze covers normal input, Prompt Board, agent launch, file drop, clear,
  close and resize.
- Boot mode is read before persisted stores and updater initialization.
- Boot/live payload placement and metadata rules.
- Snapshot row-range reduction never slices ANSI or UTF-8.
- Commit outcome releases source exactly once; every failure before commit keeps
  source layout intact.
- Single-pane external detach remains enabled.

### 14.4 Native evidence gates

- Real window creation, boot-adopt, live-adopt, source/destination close in both
  orders and one global busy prompt.
- Transfer under sustained agent TUI output and during normal shell output.
- Release-build serialize/replay timings at 10,000 rows and near 8 MB.
- macOS mixed-DPI drag spike.
- Windows WebView2 pointer-capture spike before Phase B.
- Structured logs sufficient to explain every injected failure without terminal
  content.

Repository proof remains `npm test` and `npm run build`; Rust actor/state-machine
work also requires `cargo test`. Passing unit tests alone does not close the
native evidence gates.

## 15. Remaining gates before implementation planning

The eight protocol blockers are closed at design level by §§7–9. The spec is
still not an implementation foundation until these previously identified major
items are resolved:

1. **Settings and persisted collections** — choose one write authority,
   revisions and collection conflict behavior across windows.
2. **Updater ownership** — choose app-wide update handle/state fan-out and busy
   guard semantics.
3. **Drag arbitration** — sequence samples and replies, define reject behavior,
   overlapping-window selection, stale bounds and a final pointerup hit-test.
4. **Phase A target selection** — command/menu UX for new versus existing
   windows, stable display identity and Windows parity.
5. **Native evidence** — WebView2 pointer capture and mixed-DPI measurements.
6. **Source refresh** — re-verify every source fact against the implementation
   branch and remove stale baseline claims.
7. **Living glossary** — reconcile `CONTEXT.md` multi-window wording with the
   removed session-restore contract when implementation lands.

Secondary UI questions — shortcut, menu label, initial detached-window size and
macOS Window-menu title — belong in the implementation plan only after gates
1–6 close.
