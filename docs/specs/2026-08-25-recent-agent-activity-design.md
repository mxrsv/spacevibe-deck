# Recent Agent Activity — Design

Date: 2026-08-25 · Status: decided
Target host: **Electron only**. Tauri and browser development have no session-history source.
Owner approval: a separate sidebar component aggregating agent history, showing the five most
recent sessions, confirmed 2026-08-25.
Implementation plan: [recent agent activity](../plans/2026-08-25-recent-agent-activity.md)
`building`.

## Goal

Add a distinct `Recent activity` block to the agent sidebar. It is a compact re-entry surface,
not another tier inside the live project → worktree → agent hierarchy. The block aggregates the
five most recently active resumable sessions across every supported agent and project, then sends
the user to the existing complete Sessions surface through `View all`.

This extends the existing [session-history design](2026-08-14-session-history-design.md)
`decided`. The existing session scanners, exact resume path, dead-directory guard and Sessions
dock remain authoritative; this feature does not create another history database or transcript
viewer.

## 1. Canonical data

- `sessions_list` remains the source of session identity, provider, CWD, title and
  `lastActivityMs`. The recent request uses a per-agent limit of five, then takes the newest five
  entries after the existing global descending-time sort.
- `session_tail` supplies the latest assistant sentence for those five entries. Every request pins
  `preferredId` to the listed session id; an absent or mismatched answer falls back to the session
  title, then the session id. A sentence from a different session must never be displayed.
- `dirs_exist` remains the resume liveness guard. A missing directory keeps its history row but
  makes the resume action unavailable and explains why.
- V1 therefore covers the same providers as the existing resumable Sessions list: Claude Code
  and Codex. Adding providers belongs to the session-history source, not this component.
- No activity is inferred from git changes, process output, filenames or generated classification.
  “Activity” means the newest recorded agent sentence attached to a resumable session.

The scan happens once at sidebar boot and when the user explicitly retries this block. The complete
Sessions surface keeps its own scan-on-open refresh. There is no timer: transcript walks must not
become continuous background work.

## 2. Sidebar component

The production component lives beside the existing Sessions UI under `src/ui/sessions/`. It is
injected into `AgentRail` after the live/remembered project stream and inside the same vertical
scrollport. The block is therefore visually separate while still yielding height to live agents.
The collapsed sidebar hides it completely because every useful field is prose.

The block renders:

- a sentence-case `Recent activity` heading;
- a `View all` action that opens the existing Sessions dock tab;
- exactly five rows at most, newest first;
- agent identity mark, agent label plus latest sentence, and relative time on one line;
- explicit reading, empty and recoverable error states.

On unsupported hosts the whole block is omitted. Existing last-good rows remain visible if a later
refresh fails.

## 3. Interaction

Each available recent row has one outcome: resume that exact session through the existing
`resumeSessionEntry` path. The whole compact row is its button, matching the owner-confirmed quick
re-entry contract for this sidebar block. Its accessible name begins with `Resume` and includes
the session title or id.

This is a scoped fork from DL-25.1, whose full history rows keep an inert body plus a visible
`Resume` control. The compact sidebar block does not have the width for that second visual column,
and it displays only five deliberately selected re-entry targets. The complete Sessions surface
and its safer explicit controls remain unchanged.

`View all` is navigation, not resume. It opens the complete history without selecting, filtering
or starting any session.

## 4. Treatment specification

Reference system: the supplied `RECENT ACTIVITY` screenshot for composition, the shipping
`AgentRail` for density and alignment, and DL §25 Sessions rows for identity and time semantics.

- Surface: no card and no independent background; one `--seam-recessed` separator above the block
  keeps it part of the sidebar plane.
- Header: `--type-title`, weight 560, `--text-muted`, sentence case. Deck's DL-4.3 prohibition on
  decorative uppercase overrides the screenshot's casing.
- `View all`: `--type-meta`, `--accent`; transparent at rest with the existing duration/ease and a
  stronger ink response on hover/focus.
- Rows: 30px minimum height, 7px horizontal inset, `--radius-control`, transparent at rest and
  `--state-hover-bg` on hover. No shadow, blur or new colour token.
- Identity: the existing 15px `AgentGlyph`; no synthetic status dot.
- Copy: `--type-body` at weight 450, agent label in `--text-primary`, sentence in
  `--text-muted`, one line with layout ellipsis rather than string slicing.
- Time: `--type-micro`, `--text-faint`, tabular numerals, fixed trailing column.
- Motion: the existing restrained colour/background transition only. Reduced-motion inherits the
  app-wide chrome rule.
- Width: rows hold at the 200px sidebar floor and at normal widths; summary text yields first while
  the identity mark and relative time keep their places.

## 5. States and failure handling

- **Loading with no rows:** show `Reading recent activity…` as one quiet status line.
- **Ready and empty:** show `No recent sessions.`
- **Refresh error:** retain last-good rows and show one compact Retry control; if no last-good data
  exists, the error occupies the body.
- **Missing CWD:** keep the row readable, set `aria-disabled="true"`, explain `folder is gone`, and
  do not call resume.
- **Tail absent:** fall back to title, then session id; never render a blank summary.
- **Host unsupported:** omit the entire block, including `View all`.

## 6. Scope

In scope: recent-session loading, exact tail enrichment, the five-row sidebar component, existing
Sessions navigation, Gallery proof, tests, design-language and current-state documentation.

Out of scope: new persistence, git/file event counts, arbitrary event journaling, transcript
viewing, new agent providers, polling, Tauri support, a new full-window surface, and changes to the
complete Sessions row design.

## 7. Acceptance

- The normal-width Gallery shell shows a separate `Recent activity` block with five newest-first
  sessions and no horizontal overflow.
- A compact-width Gallery shell preserves glyph/time geometry and ellipsizes only the sentence.
- `View all` opens the existing Sessions dock.
- An available row resumes the exact listed session; a dead-directory row cannot resume.
- Loading, empty, error, unsupported and stale-last-good behavior are covered by component/store
  tests.
- Targeted tests, renderer typecheck and production build pass. A Gallery screenshot is presented
  for owner eye review; automated checks alone do not close visual acceptance.
