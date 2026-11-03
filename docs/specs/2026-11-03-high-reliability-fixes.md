# High-severity reliability repairs

Date: 2026-11-03
Status: Implemented and verified locally on 2026-11-03; not merged or released.

## Authorization and scope

The owner requested repairs for the five confirmed High findings from the 2026-11-03
functional audit. Any finding whose causal evidence becomes uncertain must be reported
immediately and must not be patched speculatively. The reviewed baseline is `4ddd0ca7`.

The authorized seams are editor document lifetime, session restoration and journaling,
window identity in the coordinator, and app-wide quit preparation. Preserve the existing
UI layout, one quit confirmation dialog, main-owned census, and pane authorization.
Medium findings, updater installation, dependencies, release configuration, and sibling
repositories are outside this scope. No push, merge, release, native UI launch, or real-user
data manipulation is authorized by this repair task.

## Acceptance criteria

- **H1 — Stale editor reads:** A read started before a newer edit/save or document lifetime
  cannot replace that lifetime's text, baseline, metadata, or refusal state. Closing and
  reopening the same path must not admit the old result. Subsequent Save writes the current
  document, never content restored by a stale background read.
- **H2 — Failed editor reload:** A failed background read preserves the last usable document
  and unsaved text, leaving them visible and saveable. An initial open without usable content
  may still show the existing refusal UI. Failure remains observable through existing UI.
- **H3 — Partial session restore:** Failed tabs remain recoverable after partial or total
  restore failure, later journal writes, and app restart. A retry does not duplicate tabs that
  already restored. Deliberate dismissal is distinct from a failed restore. Failed persistence
  must not clear the only durable recovery record. CLI transcripts are not modified.
- **H4 — Quit preparation:** Every participating window suspends and durably flushes its
  journal before any PTY is killed. A slow, failed, missing, stale, or foreign acknowledgment
  cannot silently satisfy preparation. Failure or timeout cancels the attempt without killing
  panes and resumes journals; successful preparation keeps them suspended through teardown.
  There remains one confirmation dialog. The host authenticates every acknowledgment.
- **H5 — Reopened main window:** Reopening the last macOS window does not inherit the old
  window's dead state. Closing a peer cannot terminate the new main window's panes. Transfers
  from the old window cannot hand old panes to the new window after revival.
- **V1 — Evidence:** Each root cause has a regression that fails before repair and passes
  after repair. Targeted neighboring tests, renderer/main typechecks, scoped lint, and relevant
  IPC/policy checks pass. Independent review covers correctness, tests, and security.
- **V2 — Preservation:** Existing dirty work in the primary checkout is unchanged. No
  production data, dependency/version configuration, or unrelated Medium fixes are changed.

## Failure policy

Preserving recoverable data takes precedence over pretending a partial operation succeeded.
Quit preparation uses a bounded wait and cancels on failure; it never interprets a missing
renderer as successful persistence. Journal acknowledgment requires a strict flush that can
reject and drains earlier writes. Background persistence keeps its existing error reporting.

Unrestored tabs may use a separately validated pending record inside the existing
`session.json` store, without rewriting or migrating existing window records. A retry offer
must survive opening the successfully restored tabs.

## Execution record

The local execution checklist is maintained in the primary checkout at
`docs/plans/2026-11-03-high-reliability-fixes.md` (gitignored by repository policy).
