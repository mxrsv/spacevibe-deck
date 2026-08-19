# Landing stage redesign — the mock catches up with the app

- **Date:** 2026-08-20
- **Status:** approved design, spec pending owner review
- **Owner decisions taken during brainstorm:**
  1. Scope = the whole stage area: shared chrome, hero, all feature panels.
  2. Hero = ONE dense, living frame — no scene cycling (upholds the
     2026-08-19 cut of the scroll tour and the 16s reel).
  3. Panel lineup = six panels (old `grid` panel cut; Usage and Catalog added).
  4. Everything runs as code (DOM + CSS + the existing stream engine). No
     video is produced by this work.

## 1. Problem

The landing's app stage (`marketing/stage/appwin.js` + `stage-data.js`,
composed by `marketing/landing-prototype/src/directions/a.js` and
`src/tour/panel-scenes.js`) draws the July app: a workspace-list sidebar with
an "Open workspace" footer, three loose panes, and a status bar reading
"3 panes · Tokyo Night". The shipped app has moved:

- The sidebar is the **AgentRail**: one cluster per project (folder glyph →
  name → caret, plus a per-project `+`), one row per pane carrying the
  agent's **newest sentence**, its age, its brand glyph, and a 9px status dot
  (red `failed`, yellow `asked`, neutral `working`; `done`/`idle` paint
  nothing). A multi-agent tab's rows stand inside a rounded hairline frame
  (DL-27.19). Closed-but-remembered projects keep a rowless header with its
  own `+`.
- Tabs are **one strip on the stage**: one chip shape for terminal tabs
  (agent glyph + tail sentence), documents (file-type glyph), and the browser
  (globe), ordered by open sequence, with `+` and a trailing `⋯` More +
  panel toggle (DL-18.10).
- The frame row is traffic lights + sidebar toggle + `New`; the stage reaches
  the window's top edge.
- `showStatusBar: false` and `dockOpen: false` are the defaults — an honest
  default-state mock has **no status bar** and no dock.
- The default theme is `deck-dark`: the sidebar plane rises **above** the
  stage (stage is the deepest surface), chrome ink is neutral gray.
- Six built-in agents: claude, codex, opencode, agy, gemini, `cursor-agent`
  (appended 2026-08-19; no brand asset exists — the app falls back to a
  monogram).

Every claim above mirrors `src/ui/agent-rail.tsx`, `src/ui/tab-strip.tsx`,
`src/lib/agent-catalog.ts`, and `src/settings/settings-schema.ts` as of
2026-08-20; the gallery's "Current Electron target shell" specimen is the
visual reference.

## 2. Hero composition

One `.a-appwin` (~896×556 CSS px at 1440 viewport; current cqw scaling keeps
10px text legible — measured 2026-08-20), drawn in the default `deck-dark`
plane order:

```
┌ rail ~200px ───────────┬ stage ──────────────────────────────────────────┐
│ ●●●  ⛶  +New           │ [✳ tail… ×][TS layout-engine.ts][◍ localhost]│+│⋯▤│
│ 📁 spacevibe-deck ⌄  + │                            │                    │
│ ╭─ framed tab ────────╮│  claude pane (focused)     │ codex pane         │
│ │ ◌ tail sentence  ✳ ││  transcript streaming      │ transcript         │
│ │ ● tail sentence  ⬡ ││                            ├────────────────────│
│ │ ● tail sentence  ◍ ││  ❯ █                       │ opencode pane      │
│ ╰─────────────────────╯│  [Opus 5 · 32% footer]     │ transcript  > █    │
│ 📁 spacevibe-api ⌄  +  │                            │                    │
│   ● yellow: asked tail │                            │                    │
│ 📁 spacevibe-hub     + │  ← remembered, rowless     │                    │
└────────────────────────┴─────────────────────────────────────────────────┘
```

- The three streaming panes are **one multi-agent tab**, so the rail draws
  the DL-27.19 frame around exactly those three rows and the strip carries
  ONE terminal chip for them (active: claude glyph + the tail sentence + ×).
- The strip also shows an inactive file chip (`layout-engine.ts`) and an
  inactive browser chip (`localhost:5173`) — the "not only terminals" claim
  lands above the fold without a scene change.
- `spacevibe-api` cluster: one row, yellow `asked` dot, a question as its
  tail. `spacevibe-hub`: remembered rowless header with `+`.
- No status bar. No dock. The window bottom is the panes.
- Pane transcripts keep the existing three scripts in `stage-data.js`
  (claude / codex / opencode); footers stay as shipped. Stage-internal text
  stays English-only (2026-07-16 stage spec).
- Colours re-derive from `deck-dark`'s relationships: sidebar lighter than
  stage, hairline seams from `--tone`, neutral gray ink. Transcript ANSI-ish
  accent colours stay.

### Motion contract

Nothing loops decoratively; everything that moves is work the app would show:

1. The pane stream engine (`product-stage.js`) keeps typing the three
   transcripts, unchanged.
2. NEW, same engine pattern: rail rows and the active strip chip carry
   `data-tail="<paneId>"` / `data-dot="<paneId>"` hooks; a thin extension of
   the stream data lets a pane's script update its rail sentence and dot at
   named steps (working ↔ done, and the sentence swap). The active chip
   echoes the focused pane's tail through the same hook.
3. `prefers-reduced-motion` renders the completed frame instantly, as today.

## 3. Feature panels — six, in scroll order

The old `grid` panel ("from folder to full formation") is cut: the new hero
says it. Every scene is a purpose-built body in the shared `.a-appwin` chrome
(a drawing of the product, never a screenshot), per the established
`panel-scenes.js` standard.

| # | key | shape | Scene contents | Status |
|---|-----|-------|----------------|--------|
| 1 | `panelRail` | side, flip | Rail column zoomed: clusters, tail sentences, one yellow `asked` row, one red `failed` row, framed multi-agent tab, remembered header with `+`. Stage side dimmed with "the panes keep running" hint. | rebuild |
| 2 | `panelWorktree` | side | ⌘T quick picker over a blurred scrim: destination row (`folder · branch` as a menu value), then SIX agent rows with digit keys, plus the `--text-faint` key-hint line. | update (6 agents + key line) |
| 3 | `panelRestore` | wide | Three panes typing their real resume commands (`claude --dangerously-skip-permissions --resume <id>`, `codex resume <id>`, `opencode -s <id>`) and printing restored context. Commands must match `COMMAND_TABLE` in `src/lib/agent-resume.ts` at implementation time. | update |
| 4 | `panelSurfaces` | wide | Unified strip with agent + file + browser chips; file tree + editor on the stage; NEW beat: a transcript path line rendered as a ⌘+click link, the editor open at that line. | extend |
| 5 | `panelUsage` | side | The dock's Usage tab (⌘⇧Y neighbourhood): range selector + a metric table of tokens by agent/day, mirroring `src/ui/usage/`. Copy angle: reads your real `~/.claude` / `~/.codex` corpus, locally. | **new** |
| 6 | `panelCatalog` | side, flip | Settings → Agents: an **Installed** group with shipped commands (`claude --dangerously-skip-permissions`, `codex --dangerously-bypass-approvals-and-sandbox`, …) and an **Available to install** group; a starred default row. | **new** |

Copy: new EN + VI title/body pairs in `copy.js` for panels 1–6 (keys above).
Scene-internal strings remain English.

## 4. Supporting touches

- **Agent strip** (`agent-strip.js`): add Cursor as the sixth chip, monogram
  fallback exactly as the app renders it (no invented asset), keeping
  `BUILTIN_AGENTS` order.
- **Finale shortcuts row**: add `⌘⇧B` (explorer) and `⌘⇧Y` (sessions) to the
  existing six chords.
- Hero copy/CTAs, finale proofs, proof terminal, footer: unchanged.

## 5. Module architecture

| Module | Change |
|--------|--------|
| `marketing/stage/stage-data.js` | Keep `stagePanes` (scripts) and `deepFreeze`. Replace `stageSidebar` with `stageRail` (clusters → rows: paneId?, sentence, age, dot, glyph, framed?, remembered?). Add `stageStrip` (chips: kind, glyph, label, active). Keep `stageStatus` exported so the video build does not break, but the default composition no longer renders it. |
| `marketing/stage/appwin.js` | New renderers: `renderStageFrameRow` (lights + toggle + New), `renderStageRail`, `renderStageStrip`. `renderStagePane` essentially unchanged. `renderStageSidebar`/`renderStageStatus` are replaced/retained per the video note below. |
| `landing-prototype/src/product-stage.js` | Stream engine gains the rail/chip tail hooks (§2 motion contract). |
| `landing-prototype/src/directions/a.js` | Hero mounts the new composition (frame row + rail + strip + 3-pane grid, no status bar). |
| `landing-prototype/src/tour/panel-scenes.js` | Rewritten on the new chrome; scenes per §3, including two new ones. `stage-states.js` updated to match. |
| `landing-prototype/src/copy.js` | New panel copy EN + VI. |
| `styles/direction-a.css`, `styles/scenes.css` | Rail/strip/frame-row styles under `.a-appwin__*`; scene styles for the two new scenes; deck-dark plane relationships. Both files are near their size ceilings (1526 / 581 lines) — if the rework pushes either past 800-line module guidance in spirit, split the appwin styles into their own sheet. |

## 6. Affected consumer, named

`marketing/video/src/stage-driver.js` imports the shared stage modules and
will draw the NEW shell the next time anyone renders the video. This task
does not render, verify, or fix the video; the existing rendered assets in
`marketing/video/out/` are untouched. (AGENTS.md known trap, stated on
purpose rather than silently.)

## 7. Out of scope

- Rendering or updating any marketing video output.
- Changelog page, download links, release data, topbar, hero copy, plates.
- The app itself: no `src/` or `electron/` change of any kind.
- New brand assets (Cursor stays a monogram until the app itself ships one).

## 8. Verification

1. `npm run build:landing` clean; existing landing tests
   (`release-data.test.js`, `changelog-view.test.js`,
   `download-links.test.js`) stay green.
2. Playwright screenshots of the hero and each panel at 1440, 768, 390 —
   legibility check on the smallest rail sentence; no horizontal overflow.
3. `frontend-design-bar` pass on the screenshots (assembled, not generated).
4. Reduced-motion path renders every completed frame.
5. Owner eye review of the running page — build passing ≠ finished.
