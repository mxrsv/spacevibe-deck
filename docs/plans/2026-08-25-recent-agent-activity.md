# Implement Recent Agent Activity

**Spec**: [2026-08-25-recent-agent-activity-design.md](../specs/2026-08-25-recent-agent-activity-design.md)
**Goal**: Add a separate sidebar block showing the five most recent aggregated agent sessions and route `View all` to the existing Sessions dock.
**Architecture**: Reuse `sessions_list`, `session_tail`, `dirs_exist` and the existing resume path. Keep recent-session loading in the Sessions store, render it through a focused component injected into `AgentRail`, and use the same production component in Gallery.

## 1. Expected outcomes

- Five newest global session activities render in the sidebar — verify with `RecentSessionActivity renders only the five newest sessions`.
- Every summary belongs to the exact listed session — verify with `refreshRecentSessions rejects a mismatched tail id`.
- `View all` opens the existing Sessions dock and a live row resumes through the existing path — verify with the component and App wiring suites.
- Unsupported, empty, loading, error and dead-directory states remain explicit — verify with store/component state tests.
- The component holds at normal and compact sidebar widths — verify with Gallery screenshots and zero-overflow geometry checks.

## 2. Canonical data source

**Canonical data**: `sessions_list` for resumable session metadata, `session_tail` pinned by session id for the newest assistant sentence, and `dirs_exist` for resume availability.

**Taken from**: the existing Electron session-history and session-tail facades.

**Not taken from**: git diffs, file watchers, PTY text scraping in the renderer, synthetic status classification or a new persisted activity index.

## 3. Business rules and invariants

- **Five means five globally**: request five candidates per provider, keep the already time-sorted global first five — verify with mixed Claude/Codex fixtures.
- **Exact summary ownership**: accept a tail only when its returned id equals the requested `preferredId`; otherwise use title/id fallback — verify with mismatched and null tail replies.
- **No background polling**: load at sidebar boot and through explicit refresh paths only — verify that the component installs no interval.
- **Last-good data survives**: a failed refresh cannot blank known recent rows — verify with store retry tests.
- **One safe source of resume behavior**: rows call `resumeSessionEntry`; they do not construct commands — verify through App wiring.
- **Host boundary**: unsupported hosts omit the entire block — verify with `sessionsSupported=false`.
- **Collapsed boundary**: collapsed sidebar hides the prose block — verify with the rail CSS contract test.

## 4. Scope

**Build**:

- Recent-session data loading and exact tail enrichment.
- Five-row sidebar component and all UI states.
- `AgentRail` composition slot and App callbacks.
- Shipping Gallery specimen, design-language rule and current-state record.

**Do not build**:

- New IPC channels or transcript storage.
- Git/file activity counts or arbitrary event history.
- New providers, polling, Tauri support or a second complete-history surface.
- Changes to the existing full Sessions row treatment.

## 5. Risks and fixed decisions

**Fixed decisions with risk**:

- The whole compact row resumes a session — risk: it is a scoped fork from DL-25.1, so accessible naming, dead-directory refusal and the unchanged full-history `Resume` control must remain explicit.
- The block scans transcript metadata at sidebar boot — risk: directory walks still cost main-process work, so the request stays capped at five per provider and tail reads stay capped to the five global rows.
- The current history source covers Claude Code and Codex only — risk: “all agents” means all supported history providers, not every installed CLI.

## 6. Tasks

### Task 1: Expose exact session tails through the Sessions client

**Files**:

- [sessions-client.ts](../../src/sessions/sessions-client.ts)
- [sessions-client.test.ts](../../src/sessions/sessions-client.test.ts)

**Decision**: Add a typed `tails(requests)` client method backed by the existing `session_tail` facade; the memory client accepts deterministic tail replies for tests.

**Build**:

- Extend `SessionsClient` without changing the existing `list` or `dirsExist` contracts.
- Validate positional replies through the existing host facade and preserve immutable arrays.

**Verify**:

- `npm test -- src/sessions/sessions-client.test.ts` → host and memory clients return positional exact-id tail answers.

---

### Task 2: Load and normalize the five recent sessions

**Files**:

- [sessions-store.ts](../../src/sessions/sessions-store.ts)
- [sessions-store.test.ts](../../src/sessions/sessions-store.test.ts)

**Depends on**: Task 1

**Decision**: Replace the boot-only support probe with `refreshRecentSessions`, using a constant limit of five, exact-id tail matching and title/id fallback.

**Build**:

- Add immutable recent entries, dead-project state, loading state and generation guards.
- Request recent metadata, slice the global newest five, fetch pinned tails and probe unique CWDs.
- Keep last-good rows on failure and prevent a stale recent request from overriding a newer full refresh's support decision.

**Verify**:

- `npm test -- src/sessions/sessions-store.test.ts` → mixed-agent ordering, five-row cap, exact-id summary, fallback, liveness, stale generation, unsupported and last-good cases pass.

---

### Task 3: Build the Recent Activity component

**Files**:

- [recent-session-activity.tsx](../../src/ui/sessions/recent-session-activity.tsx)
- [recent-session-activity.test.tsx](../../src/ui/sessions/recent-session-activity.test.tsx)

**Depends on**: Task 2

**Decision**: Render one compact section with sentence-case heading, five one-line resume rows and explicit loading, empty, error and unavailable states.

**Build**:

- Read the recent Sessions signals and render existing `AgentGlyph`, relative-time and retry primitives.
- Give available rows accessible `Resume <session>` names; dead rows stay focusable, explain the missing folder and never invoke resume.
- Keep `View all` separate from row actions.

**Verify**:

- `npm test -- src/ui/sessions/recent-session-activity.test.tsx` → row cap/order, summary fallback, resume, View all, dead CWD, loading, empty, error/retry and unsupported tests pass.

---

### Task 4: Compose the block into the scrollable Agent Rail

**Files**:

- [agent-rail.tsx](../../src/ui/agent-rail.tsx)
- [agent-rail.test.tsx](../../src/ui/agent-rail.test.tsx)
- [13-sessions.css](../../src/styles/13-sessions.css)

**Depends on**: Task 3

**Decision**: Add an optional recent-activity slot after the project stream and inside `.asr-rail__list`; hide it in collapsed mode.

**Build**:

- Preserve the rail's direct grid placement, single scrollport and existing footer behavior.
- Apply the approved 30px row, semantic token, ellipsis, fixed-time and hover treatment without new raw colors or type sizes.
- Keep compact rows free of horizontal overflow and prevent hover/focus from shifting content.

**Verify**:

- `npm test -- src/ui/agent-rail.test.tsx src/ui/sessions/recent-session-activity.test.tsx` → slot order and collapsed/CSS contracts pass.

---

### Task 5: Wire loading, resume and View all in App

**Files**:

- [app.tsx](../../src/ui/app.tsx)
- [app.test.tsx](../../src/ui/app.test.tsx)

**Depends on**: Tasks 2–4

**Decision**: Load recent sessions at boot, pass `resumeSessionEntry` to row actions, and pass `openDockTab("sessions")` to `View all`.

**Build**:

- Replace the discarded limit-one support probe with the useful five-session recent refresh.
- Mount the block only through the Agent Rail slot; do not duplicate it in top-tab mode or the dock.
- Keep panel-obscuring and dock-tab policy unchanged.

**Verify**:

- `npm test -- src/ui/app.test.tsx` → recent boot refresh, row resume callback and existing Sessions dock navigation pass.

---

### Task 6: Render the production component in Gallery

**Files**:

- [main.tsx](../../src/gallery/main.tsx)
- [chrome-fixtures.tsx](../../src/gallery/chrome-fixtures.tsx)
- [navigation-section.tsx](../../src/gallery/sections/navigation-section.tsx)

**Depends on**: Tasks 3–5

**Decision**: Seed five uneven recent sessions and render the shipping component inside the real Agent Rail shell specimen.

**Build**:

- Seed mixed agents, varied sentence lengths, relative times and one missing directory without touching user history.
- Wire Gallery callbacks to no-ops and label the specimen as the current proposal awaiting eye review.
- Show normal and compact sidebar widths using the existing shell harness.

**Verify**:

- `npm test -- scripts/gallery-entry.test.ts` → Gallery imports production UI only in the allowed direction.
- `npm run prototype:gallery` → Navigation specimen renders five rows at normal and compact widths with `scrollWidth === clientWidth`.

---

### Task 7: Record the design rule and current delivery state

**Files**:

- [DESIGN-LANGUAGE.md](../DESIGN-LANGUAGE.md)
- [CONTEXT.md](../CONTEXT.md)
- [design-language.test.ts](../../scripts/design-language.test.ts)

**Depends on**: Task 6

**Decision**: Add DL §33 for the compact recent-activity genre and record Gallery/build evidence without claiming owner eye approval.

**Build**:

- Document the separate block, five-row cap, exact-summary rule, compact whole-row action fork and collapsed/unsupported behavior.
- Anchor current claims to production files with intent labels and add pending native/owner/Windows gates.
- Extend the design-language contract only where the new section or selector needs a specific invariant.

**Verify**:

- `npm test -- scripts/design-language.test.ts` → every new DL citation resolves and no forbidden typography/color literal is introduced.

---

### Task 8: Run scoped and baseline verification

**Depends on**: Tasks 1–7

**Decision**: Separate feature-owned evidence from failures already present in the shared dirty checkout.

**Build**:

- Recheck the diff for unrelated files and remove no concurrent artifacts.
- Capture Gallery screenshots outside the repository and present them for owner eye review.

**Verify**:

- `npm test -- src/sessions/sessions-client.test.ts src/sessions/sessions-store.test.ts src/ui/sessions/recent-session-activity.test.tsx src/ui/agent-rail.test.tsx src/ui/app.test.tsx scripts/gallery-entry.test.ts scripts/design-language.test.ts` → all feature-owned suites pass.
- `npx tsc --noEmit` → renderer typecheck exits 0.
- `npm run build` → production renderer bundle exits 0.
- `npm test` → report the complete result separately, attributing any failure only after reproducing it outside changed paths.
- Gallery normal/compact screenshots → owner confirms visual treatment before the UI is called complete.
