# Workspace dev server discovery

Date: 2026-10-09
Status: Draft — discovery scope approved; implementation approach, UI and platform rollout pending.
Owner checkout: `/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Baseline: `main` at `4c28e17b9c5c4cdfb773af1da273e500abb5c966`.
Host: Electron; frozen Tauri has no new native implementation.
Execution: [local implementation plan](../plans/2026-10-09-dev-server-discovery.md),
kept only in the primary checkout under the repository's ignored plans directory.

## Goal and approved scope

Show the local development servers belonging to projects in Deck workspaces, including
whether each observed server is still running. Users should not have to search terminal
scrollback or remember ports to find a project's running server.

Owner decisions in this conversation:

1. Research and prepare a structural implementation plan before implementing the feature.
2. Discovery includes servers launched **outside Deck**, such as from Terminal or VS Code,
   when they belong to a workspace project. External launch is not an optional extension.
3. No implementation, app launch, process termination or deployment is authorized by this
   planning request. The positive response to the research does not approve an unseen UI.
4. The owner has assigned mock UI creation to other sessions and requested a core-code plan
   separately. Core delivery must not depend on choosing panel versus popover. UI review and
   owner eye-review remain required before production UI integration; core verification is
   not acceptance of the complete user-facing feature.

The requirements and acceptance criteria below propose a precise interpretation of that
scope for review. They are not claims of shipped behavior or approval of every design choice.

## Delivery boundaries

The current planning slice is the nonvisual core: native listener discovery, canonical project
attribution, honest lifecycle/protocol state, bounded shared observation, Electron IPC and a
renderer-facing client/store. It must cover servers started outside Deck without requiring a
terminal association. Reading PTY ownership or collecting terminal output is not required for
this core slice; optional terminal navigation belongs to later integration.

Other sessions own gallery mock work. This slice does not change gallery components, production
UI, dock/menu configuration, browser behavior or the workspace catalog. A later integration
owner supplies existing workspace roots to the core and connects the eye-approved UI.
Acceptance remains split: prove AC1–AC4/AC6–AC7 at the core/IPC boundary, then complete AC5 and
the user-flow part of AC8 with the approved UI. Native core checks do not mark those UI criteria done.

## Proposed behavior

### Discovery and attribution

- Discover servers that are already running when Deck starts, as well as ones started later,
  inside or outside Deck. A server need not print a URL or use a conventional port.
- Use actual local TCP listeners as evidence of a live endpoint. Terminal output can enrich
  the URL, protocol or terminal association; old output never proves current liveness.
- Attribute a listener using observed process and filesystem evidence. Match canonical
  workspace/worktree roots with path-segment boundaries, preferring the most specific root.
  Do not infer ownership from a port number, project name, current focus or an unverified
  command-line substring.
- Keep multiple endpoints per project and different worktrees distinct. The same endpoint
  represented in two windows must not become two independent monitoring jobs.
- A project TCP listener is initially a candidate, not automatically a web server. Database,
  debugger and unidentified protocols must not acquire a fabricated HTTP URL.
- Unresolved ownership is visibly unresolved if exposed. It must not contaminate a project's
  confirmed server list. A proposed delivery that cannot attribute external servers on a
  target platform must disclose that limitation rather than claim the scope is complete.

### State and lifetime

- `Running` means the associated listener was observed in a fresh successful reading. It
  does not promise a healthy web application.
- `Stopped` means a previously observed listener is absent after successful confirmation.
  A failed or incomplete collection is not evidence that a server stopped.
- `Unknown` means current liveness cannot be established. Retained observations must carry
  their age rather than silently remain green after scanning fails or the computer sleeps.
- HTTP response status, response timeout and TLS failure are separate from listener state.
  A 404 or 500 response is not a stopped process.
- Revalidate ownership when a port or PID is reused. Do not attach an old project's URL or
  terminal action to a new process that inherited the same numeric identifier.
- Retain stopped entries only for a bounded in-session interval, with a bounded list size.
  No persistent server history or pinned expected servers is proposed for the first slice.
  Deck cannot label a never-observed, unconfigured server as stopped.

### User flow

Proposed flow: select a project/worktree, inspect its servers, then open or copy a confirmed
web URL. Offer focus of the originating Deck terminal only when its current ownership is
known. External servers have no fabricated Deck terminal association.

The preferred surface is a `Dev servers` section/tab in the existing side panel. A compact
workspace popover is an alternative. Surface placement, workspace-versus-Space filtering,
empty/error states and visual treatment must be settled in a mock before production UI work.
Status uses text as well as color, actions have accessible names and keyboard access, and
the approved design stays within the existing design-language rules unless a rule change
is explicitly approved.

Reuse the existing Deck browser and external-open/clipboard capabilities. Discovery never
automatically navigates, starts a server, sends a terminal command or steals focus.

### Platform and resource boundaries

- Keep collection in Electron main with asynchronous, bounded work shared across windows;
  renderer state remains window-scoped. Polling must not block terminal output or multiply
  by pane count. Back off when no relevant window is active and refresh on resume/focus.
- Support loopback IPv4/IPv6 and locally reachable wildcard listeners without blindly using
  `0.0.0.0` or `::` as the browser URL. Preserve known HTTP/HTTPS and host semantics.
- Any automatic protocol probe is local-only, time-bounded and concurrency-bounded, does
  not follow redirects off the approved local endpoint, and does not bypass TLS validation
  globally. Do not send browser credentials or turn probing into a periodic page crawler.
- No new dependency or native helper is presumed approved. In particular, Windows external
  process attribution needs feasibility evidence and a rollout decision before promising
  parity with macOS.
- Tauri/browser previews report unavailable instead of showing a misleading empty live list.
- Process paths, command lines and URLs remain local; existing mandatory analytics is not
  permission to add this metadata to telemetry.

## Acceptance criteria

### AC1 — Internal and external discovery

On each supported platform, find an HTTP server started inside Deck, one started from an
external terminal before Deck opens, and one started externally afterward. Include an
unusual port and a server that prints no URL. Discovery must not depend on the focused pane.

### AC2 — Correct project and worktree ownership

Two unrelated projects and two worktrees can run concurrent servers without cross-labeling.
Nested roots, path aliases/symlinks and multiple endpoints have deterministic attribution.
Insufficient evidence stays unresolved; system listeners are not presented as project web apps.

### AC3 — Honest state and restart identity

Observe start, stop, restart, port takeover and process-identity reuse. A complete successful
scan can confirm a stopped endpoint; timeout, partial output, permissions failure and
sleep/resume cannot falsely stop it or indefinitely present stale state as live. Previously
unseen endpoints do not produce invented stopped records.

### AC4 — Protocol and address correctness

HTTP, HTTPS, IPv4, IPv6, wildcard listeners, non-HTTP listeners, redirects, HTTP errors and
TLS errors keep their distinct meanings. Open actions revalidate the selected instance and
reject observed port takeovers instead of knowingly opening a different process. This is an
immediate pre-action check, not an atomic guarantee against a process changing after a URL
is handed to a separate browser. Probe failures do not imply stopped.

### AC5 — Approved user flow

The approved surface shows correct project context and useful empty, running, stopped,
unknown and unavailable states. Open in Deck, external open and copy report failures;
terminal navigation appears only for a valid associated Deck pane. Keyboard navigation,
accessible status text and visual acceptance are part of completion.

### AC6 — Bounded shared observation

Multiple windows/panes share collection. Overlapping scans, late replies, closing the last
subscriber and background/resume transitions cannot leak timers or resurrect stale state.
Measure polling cost and terminal responsiveness with multiple fixture servers; record the
actual environment and results rather than extrapolating from a single command duration.

### AC7 — Honest platform delivery

State which platforms support discovery and external project attribution. Unsupported host
capability is explicit. An approved partial platform rollout cannot be described as full
cross-platform acceptance; external attribution is never silently dropped from the goal.

### AC8 — Real Electron verification

Walk the affected flows with `playwright-core` in the running Electron app using scratch
userData and controlled fixture servers. Include external launch, already-running discovery,
stop/restart, project switching and browser open. Keep screenshots and scratch fixtures out
of the repository. Browser-only preview and unit tests do not establish native acceptance.

## Proposed exclusions

- Starting, stopping, restarting or killing servers; automatic restart and port reassignment.
- Automatic Docker/WSL/SSH/container ownership and remote port forwarding. A visible host
  forwarding listener alone does not establish ownership of the project behind it.
- Persistent history, user-defined launch recipes, pinned expected servers and health dashboards.
- A Tauri implementation, sibling-repository changes or release/updater configuration changes.

## Open decisions before implementation

1. **UI:** choose panel or popover, its filtering semantics and demo surface; approve a mock.
2. **Platform rollout:** prove Windows external ownership or explicitly approve a macOS-first
   rollout with a visible Windows limitation. External discovery remains part of the goal.
3. **Process seam:** the core proposal uses feature-owned read-only native metadata without
   changing the process classifier, PTY ownership or quit protocol. Approve any departure
   that touches those R4 seams before implementation; optional PTY links are a later slice.
4. **Delivery contract:** approve the concrete implementation slice and its verification;
   this planning task does not authorize production changes.

## Research basis

- [Architecture](../internals/overview.md), [browser surface](../internals/file-surface.md#browser-tab)
  and [repository rules](../../AGENTS.md) establish the current host and UI boundaries.
- [lsof manual](https://lsof.readthedocs.io/en/latest/manpage/) describes TCP listener and
  machine-readable field collection.
- [Get-NetTCPConnection](https://learn.microsoft.com/en-us/powershell/module/nettcpip/get-nettcpconnection)
  exposes Windows listener endpoints and owning PIDs;
  [Win32_Process](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)
  exposes parent/creation information but no working-directory property.
- [Vite server options](https://vite.dev/config/server-options) document dynamic port
  fallback, wildcard binding and localhost address-family differences.
