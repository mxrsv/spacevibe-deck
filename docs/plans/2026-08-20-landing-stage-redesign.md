# Landing stage redesign — implementation plan

- **Date:** 2026-08-20
- **Status:** `current` — authored, not started
- **Spec:** [2026-08-20-landing-stage-redesign-design.md](../specs/2026-08-20-landing-stage-redesign-design.md) `decided`
- **Branch:** `claude/agent-pipeline-landing-redesign-tkigjs`
- **Fork status:** not a fork. No `docs/DESIGN-LANGUAGE.md` rule moves (DL binds app chrome; this is a marketing drawing of it), no sibling repo, no bundle/signing/updater config, no R4 seam. One AGENTS.md **Known trap** applies and is named in §7: *"Marketing video shares application components and a virtual clock; component changes can silently alter rendered media."*

**Outcome.** The landing's app stage stops drawing the July app and draws the shipped one. The hero becomes one still, living `.a-appwin` in `deck-dark`'s plane order — an AgentRail of project clusters and per-pane sentence rows, one unified tab strip carrying a terminal chip, a file chip and a browser chip, a frame row of traffic lights + sidebar toggle + `New`, three streaming panes, and **no status bar and no dock**, because `showStatusBar: false` / `dockOpen: false` are the shipped defaults. The old `grid` panel is cut and its whole stranded chain deleted; the remaining four panels are rebuilt on the new chrome and two new ones (Usage, Catalog) are added. The stream engine grows a rail/chip tail hook so a pane's script updates its rail sentence and status dot at named steps, on both the animated and the reduced-motion path. Nothing is deleted from `marketing/stage/` — every export the marketing video links against survives, and the video keeps building.

---

## 1. Spec deviations — the shipped source wins

The spec's premise is "the mock catches up with the app". Wherever the spec's description of the app disagrees with `src/`, **the source wins**. Ten disagreements were found by a source read at HEAD 2026-08-20; an eleventh was found while planning. Each resolution is folded into the task that implements it — an implementer never re-derives these.

| # | Spec said | Source says | Resolution adopted | Owned by |
|---|-----------|-------------|--------------------|----------|
| **D1** | §1: "9px status dot (red `failed`, yellow `asked`, neutral `working`; `done`/`idle` paint nothing)" | `04a-agent-rail.css:668-742`: the box is 14px in every state. `failed` = 9px `--red`; `asked` = 9px `--status-unread`; **`working` = `::before{content:none}` and the 14px `--text-primary` spinner ring instead**; **`done` and `idle` BOTH paint a 9px `color-mix(--tone 45%)` dot** (`:736-742`) | Four paints, not three. `done`/`idle` get a quiet gray dot (`rgba(255,255,255,.45)`, flattening to **#888c8e** over the rail). `working` gets the ring, drawn as the app draws it: 8 still `<circle>`s in a `viewBox="0 0 26 26"`, `R=10.4`, `DOT_R=2.2`, first at −90°, each carrying `style="--dot:N"`, animated by a copy of `wschase` (`02-shell.css:444-480`) — a 1.2s `opacity: 1 → 0.15` ramp staggered `(N-8)*0.15s`. **Nothing rotates.** A static ring at 14px beside a 9px dot reads as "a bigger dot", not "working", and the ring is the one thing the rail says about a live agent. | T2 (markup), T17 (CSS) |
| **D2** | §1's premise that the strip seam matches the old mock's soft hairline | `06-stage-panes.css:52-60`: `.stage__strip { border-bottom: 1px solid var(--seam-divider) }` = `rgba(255,255,255,0.12)`, changed 2026-08-17 to match the pane splits. `--seam-recessed` is used nowhere on the strip | The strip's closing hairline is `var(--sg-hairline)` — the 12% tone line, the same one the pane splits use. It is **not** `--sg-hairline-soft`. | T17 |
| **D3** | §3 panel 3: `claude --dangerously-skip-permissions --resume <id>` | `agent-resume.ts:41`: the claude id form is **`claude --resume ${id}`** — no permissions flag. `codex resume ${id}` (`:46`) and `opencode -s ${id}` (`:51`) are correct | Panel 3 prints `claude --resume 0f3a91c2`, `codex resume 019a4f1c`, `opencode -s 3b77ae`. Note the *existing* `panel-scenes.js:50-81` already had claude right — the spec introduced this error. The one real change is codex: today's `codex resume --last` is the *latest* form; the id form is what a restore of a known session types. | T13 |
| **D4** | §3 panel 6: "a starred default row" | `launch-profile-editor.tsx:42-46`: both "Set default" and the ↗ website link were **removed on the owner's ask 2026-08-19**. `BuiltinAgent.url` and `Settings.defaultAgent` are kept as data only. No `Star` icon exists anywhere in `src/ui/settings/`. The enable control is a two-button `role="radiogroup"` labelled verbatim **"Enabled" / "Disabled"** (`:97-128`) | **The mock must not draw a starred row.** Panel 6 draws the Enabled/Disabled segmented radiogroup and nothing else per row. | T16 |
| **D5** | §3 panel 5: "the dock's Usage tab (⌘⇧Y neighbourhood)" | `default-keymaps.ts:211` `toggle-usage` = **⌘⇧U**; `:218` `toggle-sessions` = ⌘⇧Y; `:206` `toggle-explorer` = ⌘⇧B | Panel 5's copy says **⌘⇧U**. §4's finale addition (⌘⇧B explorer, ⌘⇧Y sessions) is **correct** and ships as written. | T9, T15 |
| **D6** | §2's ASCII hero draws the cluster caret and `+` as always-on | `04a:265, 271-274, 355-366`: `.asr-cluster__caret { opacity: 0 }` and `.asr-cluster__add { opacity: 0 }` — both paint only on `:hover` / `:focus-visible`. A **collapsed** cluster keeps its caret. The remembered header's `×` is hover-only too. `.asr-cluster__still` (`:228`) has **no caret at all, ever** | **Decided — see §1.1.** | T1, T2, T11, T17 |
| **D7** | §2 draws a "framed tab" implying a parent row above the leaves | `agent-rail.tsx:201, 216-217`: `PANE_TREE_HIDDEN = true`, so **every multi-agent tab is headless** — no parent row renders; the panes render as `.asr-leaf.asr-leaf--flat` buttons. The framed item paints **no selection wash and no accent bar** (`04b:80-84`) | **Decided — see §1.1.** | T2, T11, T17 |
| **D8** | §3 panel 5: "range selector + a metric table" | `overview-section.tsx:246`: the range selector belongs to **Overview only**, and Overview has **no table at all**. Only Daily and Breakdown use `MetricTable`. The composite does not exist on any one view | **Decided — see §1.2. Panel 5 draws Overview.** | T15 |
| **D9** | §3 panel 6: shipped commands including opencode's | `agent-catalog.ts:66`: opencode has **no `defaultCommand` key**, by design. `catalogLaunchCommand` falls back to `builtin.id` (`:230-239`) | opencode's row prints the bare word `opencode` with an **empty** `.lp-command__flags` span. The span still renders — the row's grid must not collapse. | T16 |
| **D10** | §2: "~896×556 CSS px at 1440 viewport"; the `stage-data.js` transcript scripts | Marketing-side facts, not app claims — but the first one is **measurable, and it is right**: the built page gives `.a-appwin` **896 × 555.5** at a 1440 viewport (headless chromium, HEAD 2026-08-20). `.a-appwin__sidebar` measures **223.5 / 159.4 / `display: none`** at 1440 / 768 / 390 | The figure stands as **measured**, not as an unverified assertion. The mock keeps `aspect-ratio: 1000/620` (`direction-a.css:489`) and its `cqw` scaling; no task is asked to *assert* a pixel measurement, but §6 gate 2 now re-measures the same three widths (§6, M6/M7 numbers). The three transcript scripts are kept as shipped (spec §2). | — |
| **D11** | *(beyond the note's ten)* §2 motion contract: "The active chip echoes the **focused** pane's tail" | `tab-strip.tsx:147-148` → `tabTail(tab, tails)` → `loudestPane(paneRows(...))?.message` (`agent-rail-model.ts:300-307`, `:314`). The chip prints the **loudest** pane's sentence by `STATE_RANK` (failed 4 > asked 3 > working 2 > done 1 > idle 0), tie-broken by newest `changedAt` then pane order | **The mock binds the chip to the focused pane** (`data-tail="claude"`). Reproducing `STATE_RANK` needs a cross-pane scheduler the stream engine does not have — each pane runs an independent timer (`product-stage.js:68-117`). The two agree whenever the focused pane is loudest. Recorded as a knowing simplification; nothing on screen claims otherwise. | T5, T7 |
| **D12** | *(beyond the note's ten)* Spec §5 row 1: "Replace `stageSidebar` with `stageRail`"; spec §6: the video "will draw the NEW shell the next time anyone renders" | Nothing in `src/` disagrees — this one is a **deliberate deviation from the spec**, not a source correction. `marketing/video/src/stage-driver.js` hard-requires a `[data-ws-avatar="${BRAND.slug}"]` node (`:121`), writes to it every frame (`:234`), and derives `sidebarStatus` (`:95-100`) from a flat `{id, active}` list that `stageRail` does not have | **`stageSidebar` and `renderStageSidebar` are KEPT, and the video keeps drawing the July shell BY CHOICE.** Replacing them means rewriting `stage-driver.js` and re-rendering the video, which spec §7 puts out of scope — so the deviation is taken rather than the spec's word. It is a **deviation, not a deferral**: the record T21 writes must say the video's shape drift is now permanent-until-migrated, alongside the colour drift of §2.4. | T1, T5, T21 |

### 1.1 D6/D7 decided — what the STILL hero frame shows

**The premise "a mock has no pointer" is false here, and this plan does not use it.** The
landing hero is live DOM in a real browser: `.a-appwin__cluster:hover .a-appwin__clusteradd
{ opacity: 1 }` is one rule and it works. The pointerless surface is the **video**, which is
captured headless. What the fixture decides is therefore only what the **resting frame** draws —
the frame a visitor sees before moving the pointer, and the frame every screenshot and every
video capture takes.

**Decision: at REST the hero rail draws zero carets and zero `+` glyphs, and the multi-agent tab
draws no parent row. The reveals themselves are live on the page.**

- Every cluster header in the hero is **folder glyph → project name, and nothing else.** That is not an omission; it is `04a:265` and `04a:355-366` rendered faithfully.
- **The two trailing 17px tracks stay, empty.** `.asr-cluster__head` is `grid-template-columns: minmax(0,1fr) 17px 17px; gap: 7px` (`04a:166-187`) and `04a:373` reserves the caret's gutter with `margin-left: 24px` (7 gap + 17 slot). Those tracks are why the header's name column stops exactly where the rows' name column stops — the alignment the 2026-08-19 re-amend bought after the header stood 11px wider than every row under it (AGENTS.md fork queue). **Collapsing the empty tracks is the single easiest way to get this wrong.**
- None of the hero's three clusters is collapsed, so no caret appears anywhere. `spacevibe-hub` is the remembered, rowless one and uses `.asr-cluster__still`, which has no caret by construction.
- The `spacevibe-deck` cluster's multi-agent tab renders **exactly three `.asr-leaf--flat` buttons inside the inset frame** — mark, sentence, age, brand glyph — and the framed item paints no selection wash and no accent bar. The frame itself is `box-shadow: inset 0 0 0 1px var(--hair-strong)` at `--radius-control` with `margin: 3px 0; padding: 3px 0` (`04b:113-118`) — an inset hairline, **deliberately not a border and not an outline** (`04b:86-112`: a border bled the block 1px past its container; an outline paints outside and gets clipped).
- **The reveals are ported, not dropped.** T17 copies the app's own reveal rules verbatim — `.asr-cluster:hover .asr-cluster__add` / `.asr-cluster__add:focus-visible` (`04a:271-274`) and `.asr-cluster:hover .asr-cluster__caret` / `.asr-cluster__toggle:focus-visible .asr-cluster__caret` / `[data-collapsed="true"]` (`04a:363-366`). Ink fades; the 17px boxes never move, which is exactly why the app reveals with `opacity` and never with `display` (`04a:255-262`). So on the live page a visitor who moves the pointer over a cluster gets the `+` and the caret **as the app gives them**, and spec §1's headline "plus a per-project `+`" is not lost to a screenshot convention. Cost: two selectors.
- **Where the `+` is said without a pointer:** (a) the frame row's `New` control and the strip's `+` are always-on in the app and sit above the fold regardless; (b) **panel 1 (`panelRail`) draws one baked hover state.** A zoomed rail panel is a purpose-built drawing of one interaction, so `is-hover` on the *remembered* header reveals its `+` and its `×` — a frame the app really produces — while every other header stays at rest. Panel 1 also draws one **collapsed** cluster, the one legitimate resting state in which a caret is visible.
- **D6 stays flagged for the owner.** This plan settles the resting frame and ports the reveals; whether the *hero* should instead bake a hover — spending its one still frame on an affordance rather than on the rail's resting shape — is an eye-review call, and gate 5 is where it gets made.

### 1.2 D8 decided — panel 5 draws Usage → Overview

**Decision: Overview's hero + range selector. The metric table is out; the scene must not draw table headers.**

Four reasons, in order of weight:

1. **The spec's one named element only exists there.** The range selector lives inside Overview (`overview-section.tsx:246`) and nowhere else. Drawing Overview keeps what the spec asked for and drops the table; drawing Daily keeps the table and would have to *invent* a header-level range selector — which is precisely the composite that does not exist.
2. **Shape.** Panel 5 is `side` (spec §3), a narrow art column. `MetricTable` cells are `white-space: nowrap` inside `overflow-x: auto` (`12-usage.css:202-306`); a four-column table in a `side` panel either scrolls or clips at 1440 and is unreadable at 390. Overview is a vertical stack that compresses honestly.
3. **The copy angle.** Spec §3 asks panel 5 to say "reads your real `~/.claude` / `~/.codex` corpus, locally". A big derived figure with per-agent share bars says *"this number came from your machine"*; a table of days says *"here is a log"*.
4. **Honesty about coverage.** `USAGE_AGENT_LABEL` (`usage-format.ts:42-45`) covers only `claude: "Claude Code"` and `codex: "Codex"` — the scanner covers those two agents. The per-agent list therefore draws exactly two rows, which is also exactly what the copy angle names.

Contents, verbatim from source: eyebrow `Raw token cost` → the large `$X` figure with its `*` → footnote → the range selector `Today · 7 days · 30 days · All` with **`All` active** (`usage-ranges.ts:29-44`, default `all` at `:47`; option style is a 4% `--fg` wash, `border-radius: var(--radius-tight)`, `--type-meta`, **no pill, no shadow**, `12-usage.css:428-458`) → the estimate note `estimated at API prices · pricing snapshot <date>` (`usage-format.ts:53`) → `<ul class="usage-hero__agents">` of two rows, each logo + label + amount + a share bar + a sub-line in the form `41.2% of cost · 1.2B tokens`.

The panel's left rail draws the three view names in display order — **Overview · Daily · Breakdown** (`usage-views.ts:36-48`) — with Overview active: `border-left: 2px solid var(--accent)` + `--text-primary`, the others `--text-faint` (`12-usage.css:123-150`). Naming the two views it is *not* showing is what keeps one honest drawing from implying Usage has only one screen.

---

## 2. The colour re-derivation

Spec §2 says colours re-derive from `deck-dark`'s relationships. `marketing/landing-prototype/styles/tokens.css:64-78` holds the mock's entire colour vocabulary — nine `--sg-*` tokens. All nine change value; eleven are added. **Every token NAME is kept**, because `video.css` and the existing rules read them.

### 2.1 The nine existing tokens

| token | today (`tokens.css:69-78`) | new value | app counterpart |
|---|---|---|---|
| `--sg-bg` | `#18181c` | **`#17181c`** | `--bg` — the stage, the **deepest** plane |
| `--sg-fg` | `#cbd1ea` | **`#e7e7e7`** | `--text-primary` (= preset `foreground`, `t=0.00`, 8.22:1 on `--tab-active-bg`) |
| `--sg-fg-dim` | `color-mix(#cbd1ea 62%)` | **`#c7c7c8`** | `--text-muted` (seed `#adadae`, raised at `t=0.32`, 6.02:1) |
| `--sg-fg-faint` | `color-mix(#cbd1ea 40%)` | **`#adaeaf`** | `--text-faint` (seed `#7f8082`, raised at `t=0.36`, 4.57:1) |
| `--sg-accent` | `#93abde` | **`#6f9cff`** | `--accent` = `theme.blue` |
| `--sg-green` | `#9dba7e` | **`#8ccf7e`** | `theme.green` |
| `--sg-yellow` | `#c8ab80` | **`#e5c07b`** | `theme.yellow` = `--status-unread` — the `asked` dot |
| `--sg-purple` | `#c0ade4` | **`#c792ea`** | `theme.magenta` |
| `--sg-hairline` | `color-mix(#cbd1ea 14%)` | **`rgba(255, 255, 255, 0.12)`** | `--hair` / `--seam-divider` — pane splits, strip bottom, window border |
| `--sg-hairline-soft` | `color-mix(#cbd1ea 8%)` | **`rgba(255, 255, 255, 0.08)`** | *hue-only change.* **Do not** make this the app's solid `--sidebar-seam`. It has **ten consumers across four sheets**, not the four this plan first named: `direction-a.css:602, 713, 826` (`.a-appwin__pane`'s border among them), `scenes.css:59, 256, 364`, `tour.css:345`, `video.css:196, 205, 319`. A near-`--bg` solid would erase the pane edges on the landing **and** change three video rules. T19 and T20 own two of those sheets and must know their sheets read it |

### 2.2 Eleven new tokens

Each is named after its app counterpart so the mapping stays checkable.

| new token | value | app counterpart / use |
|---|---|---|
| `--sg-rail` | `#272d31` | `--sidebar-bg`, a **pinned literal** (`derive-colors.ts:166-168`, keyed on the background string; not reachable by mixing). The rail and frame row plane |
| `--sg-seam-column` | `#1f2327` | `--sidebar-seam` — the **one** structural vertical line, `.a-appwin__sidebar + *` |
| `--sg-chrome-1` | `#2d3337` | `mix(#272d31, #fff, .03)` — picker `.achip` ground, catalog row ground |
| `--sg-chrome-2` | `#343a3d` | `mix(#272d31, #fff, .06)` — hover, the `{n} detected` count pill |
| `--sg-raised` | `#3d4246` | `--tab-active-bg` = `mix(#272d31, #fff, .10)` — the active chip |
| `--sg-hair-strong` | `rgba(255, 255, 255, 0.2)` | `--hair-strong` — the DL-27.19 inset frame, the active chip's border |
| `--sg-tab-rest` | `rgba(255, 255, 255, 0.03)` | `--tab-rest-bg`, a static token **deliberately kept out of `derive-colors.ts`** (`01-tokens.css:42`). Over the stage it flattens to `#1e1f23` |
| `--sg-red` | `#ef6b73` | `--red` — the `failed` dot |
| `--sg-quiet-dot` | `rgba(255, 255, 255, 0.45)` | the `done`/`idle` dot ink; flattens to **`#888c8e`** over `#272d31` |
| `--sg-seam-raised` | `#3a4044` | `mix(#272d31, #fff, .09)` — the picker panel's 1px border |
| `--sg-seam-recessed` | `#1c1d21` | `mix(#17181c, #fff, .02)` — the only seam still measured from `bg`; catalog row separators |

**Named consequence of the ink change.** `--sg-fg-dim` and `--sg-fg-faint` stop being `color-mix`
alphas and become opaque hex. That is correct — it is what the app's `--text-muted` / `--text-faint`
are — but an alpha and a hex do not composite the same way. Anywhere those two tokens are painted
over something other than `--sg-bg` the result moves: `video.css`'s washes, and
`.a-appwin__wsitem.is-active` (which the video still renders through `renderStageSidebar`). No rule
changes; the pixels do. It is a small, one-directional shift — opaque ink stops picking up the plane
under it — and it is recorded here rather than found later.

The modal scrim is written inline exactly as the app does — `color-mix(in srgb, var(--sg-bg) 42%, transparent)` with `backdrop-filter: blur(10px)` (`10-modals.css:8-20`) — rather than earning a token for one use.

### 2.3 The plane order this produces

Stage `#17181c` is the **deepest** surface. The rail and frame row stand **above** it at `#272d31`. The active row/chip is `#3d4246`. The window's one structural shell line is **vertical**: `.a-appwin__sidebar + * { border-left: 1px solid var(--sg-seam-column) }`. The rail's top-left corner is seamless with the frame row because both use `--sg-rail` (`02-shell.css:42`). This inverts the old mock, where the sidebar was the darker plane.

### 2.4 NAMED CONSEQUENCE — `tokens.css :root` is shared with the video

`marketing/video/src/main.js:9` imports `../../landing-prototype/styles/tokens.css`, and `video.css` resolves `var(--sg-*)` **23 times** from that same `:root`. Changing these values **re-colours the entire marketing video** the next time anyone renders it — even though this plan renders nothing and touches no file under `marketing/video/` except one import line.

That is a **second channel of video drift on top of the markup drift spec §6 already accepts**: after this work, the rendered assets in `marketing/video/out/` are stale in *colour* as well as in *shape*. There is no way to avoid it short of forking the token block into a video-local `:root`, which would guarantee the two surfaces diverge permanently — the opposite of why the tokens are shared. **Stated on purpose, not silently.** T21 records it.

---

## 3. Fixed contracts — read this before any task

The tasks below run in parallel. They do **not** get to invent names. Everything two tasks must agree on is fixed here.

### 3.1 Data shapes (`marketing/stage/stage-data.js`, T1)

```js
stageRail: Array<{
  project: string,
  remembered?: boolean,   // rowless still header — no caret, ever
  collapsed?: boolean,    // caret VISIBLE at rest, rows hidden
  hovered?: boolean,      // bakes the hover reveal (+ / x). Scenes only, never the hero
  tabs: Array<{
    framed: boolean,      // several panes, no parent row -> the DL-27.19 inset frame
    panes: Array<{
      id: string | null,  // paneId; drives data-tail / data-dot. null = static row
      agent: string,      // AGENT_MARKS id
      message: string,    // the tail sentence
      age: string,        // "" | now | 2m | 3h | 2d | 5w  (weeks are the largest unit)
      state: "failed" | "asked" | "working" | "done" | "idle",
    }>,
  }>,
}>

stageStrip: Array<{
  kind: "terminal" | "file" | "browser",
  agent?: string,         // terminal only
  paneId?: string | null, // terminal only; drives the chip's data-tail
  label: string,
  active: boolean,
}>
```

**A chip's mark is decided by `kind` alone — there is no `glyph` field.** An earlier draft carried
`glyph?: string  // file only, e.g. "ts"` beside a `file` entry in `STAGE_ICONS`, which is two
readings of the same chip: a text label and an svg. One wins, and it is the svg — a terminal chip
draws its agent `<img>`, a file chip draws `STAGE_ICONS.file`, a browser chip draws
`STAGE_ICONS.globe`, all in the one mark slot §3.3 gives every chip. That is also what the app does:
DL-18.10's chips "differ only by their glyph — an agent brand mark, a **file-type icon**, a globe".

Both wrapped in `deepFreeze`, matching the file's idiom. Pane `steps` gain two optional fields, `tail: string` and `state: <one of the five>`; existing fields are untouched.

### 3.2 Renderer signatures (`marketing/stage/appwin.js`, T2)

New renderers are **pure functions of their argument** — no module-level data import, exactly like `renderStagePane(pane)` already is. This is what decouples T1 from T2 and lets a tour scene pass its own fixture.

```
renderStageFrameRow(): string
renderStageRail(rail): string
renderStageStrip(strip): string
```

All three follow the file's idiom **exactly**: 100% template-literal HTML strings, arrays via `.map(…).join("")`, conditional classes as inline ternaries appended to the class attribute. **No `document.createElement` in this file.**

### 3.3 Class vocabulary

```html
<!-- renderStageFrameRow() -->
<div class="a-appwin__framerow">
  <span class="a-appwin__lights"><i></i><i></i><i></i></span>
  <span class="a-appwin__ctl a-appwin__sidebartoggle">…SidebarSimple, filled…</span>
  <span class="a-appwin__new"><i class="a-appwin__newglyph"></i>New</span>
  <span class="a-appwin__framespacer"></span>
</div>

<!-- renderStageRail(rail) -->
<aside class="a-appwin__sidebar a-appwin__rail">
  …renderStageFrameRow()…
  <div class="a-appwin__raillist">
    <section class="a-appwin__cluster[ is-collapsed]">

      <!-- LIVE header: exactly TWO grid children. The caret lives INSIDE the
           toggle, which spans every track; the `+` is pinned over track 2. -->
      <div class="a-appwin__clusterhead[ is-hover]">
        <span class="a-appwin__clustertoggle">          <!-- grid-column: 1 / -1 -->
          <span class="a-appwin__clusterfolder">…</span>
          <span class="a-appwin__clustername">spacevibe-deck</span>
          <span class="a-appwin__clustercaret">…</span> <!-- margin-left: 24px -->
        </span>
        <span class="a-appwin__clusteradd">…</span>     <!-- grid-column: 2; z-index: 1 -->
      </div>

      <!-- REMEMBERED header: the toggle is REPLACED by a still span in track 1.
           No caret element exists at all. The `×` takes the caret's track. -->
      <div class="a-appwin__clusterhead is-still[ is-hover]">
        <span class="a-appwin__clusterstill">           <!-- grid-column: 1 -->
          <span class="a-appwin__clusterfolder">…</span>
          <span class="a-appwin__clustername">spacevibe-hub</span>
        </span>
        <span class="a-appwin__clusteradd">…</span>     <!-- grid-column: 2; z-index: 1 -->
        <span class="a-appwin__clusterremove">…</span>  <!-- grid-column: 3; z-index: 1 -->
      </div>

      <div class="a-appwin__item[ is-framed]">
        <!-- framed: N x .a-appwin__leaf ; bare: 1 x .a-appwin__row -->
        <button class="a-appwin__leaf" data-state="working">
          <span class="a-appwin__mark a-appwin__leafmark" data-state="working" data-dot="claude">…spinner svg…</span>
          <span class="a-appwin__leafmsg" data-tail="claude">…</span>
          <span class="a-appwin__leafage">now</span>
          <img class="a-appwin__leaflogo" … />
        </button>
        <!-- the bare row, same four cells, its OWN child names -->
        <button class="a-appwin__row" data-state="asked">
          <span class="a-appwin__mark a-appwin__rowmark" data-state="asked" data-dot="api">…spinner svg…</span>
          <span class="a-appwin__rowmsg" data-tail="api">…</span>
          <span class="a-appwin__rowage">3h</span>
          <img class="a-appwin__rowlogo" … />
        </button>
      </div>
    </section>
  </div>
</aside>

<!-- renderStageStrip(strip) -->
<div class="a-appwin__strip">
  <div class="a-appwin__chips">
    <div class="a-appwin__chip is-active" data-kind="terminal">
      <img class="a-appwin__chiplogo" … />
      <span class="a-appwin__chiplabel" data-tail="claude">…</span>
      <span class="a-appwin__chipclose">…</span>
    </div>
    <div class="a-appwin__chip" data-kind="file">…STAGE_ICONS.file…</div>
    <div class="a-appwin__chip" data-kind="browser">…STAGE_ICONS.globe…</div>
    <span class="a-appwin__chipadd">…</span>
  </div>
  <div class="a-appwin__stripactions">
    <span class="a-appwin__ctl">…DotsThreeOutline, filled, 15px…</span>
    <span class="a-appwin__ctl">…SidebarSimple, filled, mirrored…</span>
  </div>
</div>
```

**Six rules that will otherwise be got wrong:**

1. **`.a-appwin__sidebar` is KEPT as the rail's outer class**, with `a-appwin__rail` added beside it. `.a-appwin__sidebar + *` (`direction-a.css:601`) is an *adjacency* selector carrying the stage's only structural seam, and `.a-appwin__sidebar { display: none }` (`:1358`) is the entire mobile strategy. Both fire off the element's position and class, in the hero, the tour **and the video**, with **no error** if renamed. One extra class token buys all of that; renaming buys nothing.
2. **The spinner SVG is always in the DOM**, inside every `.a-appwin__mark`. CSS shows it only for `[data-state="working"]` and suppresses the `::before` dot in that one state. That is why the stream engine can repaint a pane's whole status by writing **one attribute** and never touching markup. **This is a deliberate divergence from the app**, which pairs `data-state` with a `.asr-row__mark--spinner` modifier class (`04a:725-733`). The mock has no modifier: `data-state` is the whole switch, so **every rule about the working state — including T17's reduced-motion rule — is written as `[data-state="working"]`, never as a `--spinner` selector**, which would match nothing.
3. **`data-tail="<paneId>"` and `data-dot="<paneId>"` appear on MORE THAN ONE node per pane** — the rail leaf/row and the active strip chip. Every lookup is `querySelectorAll`, never `querySelector`.
4. **The cluster header is a three-track grid with TWO (or three) children, not four.** `grid-template-columns: minmax(0,1fr) 17px 17px`. Four direct children auto-place the caret onto an implicit **second row** — which is the 11px-misalignment class of bug §1.1 exists to prevent, arriving by a different door. The app avoids it with a wrapper, and so does the mock: `.a-appwin__clustertoggle` holds folder + name + caret and spans `grid-column: 1 / -1` (`04a:189-196`); `.a-appwin__clustername` is `min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis` (`04a:330-335`), which is what pushes the caret to the toggle's right edge; `.a-appwin__clusteradd` is pinned at `grid-column: 2; z-index: 1` **on top of** the spanning toggle (`04a:247-254`); `.a-appwin__clustercaret` is pushed clear of it by `margin-left: 24px` = 7 gap + 17 slot, applied through `.a-appwin__clusterhead:has(.a-appwin__clusteradd)` (`04a:373-375`). A remembered header swaps the toggle for `.a-appwin__clusterstill` at `grid-column: 1` with **no caret element at all** (`04a:228-239`), and `.a-appwin__clusterremove` takes `grid-column: 3` (`04a:293-297`). **`is-still` is a class on the header, and it changes which child is emitted** — it is not a styling-only flag.
5. **The bare row's children are named here too.** Row grid is `17px minmax(0,1fr) auto 17px` (`04b:19`), and the row's set is `.a-appwin__rowmark` / `__rowmsg` / `__rowage` / `__rowlogo`, mirroring the leaf's `__leafmark` / `__leafmsg` / `__leafage` / `__leaflogo`. **The status mark carries two classes**: `a-appwin__mark` is the shared *painting* hook (the four dot states and the spinner, identical on leaf and row, and the `data-dot` the stream engine writes), and `__rowmark` / `__leafmark` is the *geometry* hook. They are separate because the two ages are not the same colour — `__rowage` is `--sg-fg-faint` and `__leafage` is `--sg-fg-dim`, reproducing the app's own asymmetry (`04a:522-533` vs `04b:272-275`) — and a task cannot honour that with one class. **Cell 4 holds `__rowlogo` / `__leaflogo`.** The app's hover close (`.asr-row__actions`) does not get a fifth cell: it is pinned to that *same* cell 4 and overlaps the glyph (`grid-row: 1; grid-column: 4; z-index: 1`, `04a:606-621`, DL-27.5). `.a-appwin__rowclose` is reserved for that slot and **no fixture in this plan emits it** — the reveal §1.1 ports is the cluster `+`, which is inert on a drawing; a close control that cannot close is a worse lie than an absent one.
6. **New icon controls are `.a-appwin__ctl`, NOT `.a-appwin__iconbtn`.** `renderStageTitlebar` still emits five `.a-appwin__iconbtn` for the video (`marketing/stage/appwin.js:41-53`), and its rules (`direction-a.css:567-574`) move into `appwin.css` under T10, which registers that sheet in the **video** entry. Restyling `.a-appwin__iconbtn` would therefore reach the video's titlebar silently — the AGENTS.md trap §7 names. **The same applies to every class the video's titlebar path already emits: `.a-appwin__lights`, `.a-appwin__titlebar`, `.a-appwin__actions`, `.a-appwin__actionsep`, `.a-appwin__iconbtn`. T17 may READ them and may reuse them as-is — the frame row deliberately reuses `.a-appwin__lights`, which is why the traffic lights match for free — but T17 MUST NOT change any of their existing declarations.** Everything new gets a new name.

### 3.4 Hero and scene composition

```html
<figure class="a-appwin" role="img" aria-label="${STAGE_ARIA_LABEL}">
  <div class="a-appwin__body" aria-hidden="true">
    ${renderStageRail(stageRail)}
    <div class="a-appwin__stage">
      ${renderStageStrip(stageStrip)}
      <div class="a-appwin__grid">…three panes…</div>
    </div>
  </div>
</figure>
```

`renderStageStatus()` is **not called**. The window bottom is the panes. Note carefully: `.a-appwin__sidebar + *` now resolves to **`.a-appwin__stage`**, not `.a-appwin__grid` — the new wrapper is what takes the `border-left`, and the grid must not also carry one.

`scenes/chrome.js`'s helper is `frame(body, { rail = SCENE_RAIL, strip = null } = {})`, same shape, with `body` in place of the grid. When `rail` is null the `<aside>` is absent, the adjacency does not fire, and the stage gets no left seam — which is exactly today's `{ sidebar: false }` behaviour.

### 3.5 Stream engine contract (`product-stage.js`, T5)

```
mountStageStream(gridRoot, { chromeRoot = gridRoot } = {})
```

- Rail and chip nodes live **outside** `gridRoot` (the hero passes `section.querySelector(".a-appwin__grid")`), so the hook lookup takes a second, wider root. The hero passes the `.a-appwin` `<figure>`.
- Hook nodes are resolved **once at mount** into a per-pane array (`chromeRoot.querySelectorAll('[data-tail="…"]')` / `[data-dot="…"]`), not per step.
- **Missing hooks are tolerated** — an empty array, no throw. This is the opposite of `[data-lines]` / `[data-spinner]`, which keep throwing `Stage pane "<id>" markup is missing.` A panel with no rail is normal.
- `applyStep` is the **single funnel** — both `runPane` (`:84`) and `renderStaticFrame` (`:63`) go through it, so a step-carried field applied there is automatically correct on the reduced-motion path.
- **`renderStaticFrame` must be widened.** Today it replays only `line` / `chunk` steps (`:58-66`). It must walk **every** step in order applying `tail` / `state` — including `think` and `rest` — so the completed frame carries the *final* sentence and the *final* dot. Missing this is exactly how spec §8.4 fails.
- **NEW — the animated path must not start at the END.** Widening `renderStaticFrame` creates a second defect if nothing else changes: `mountStageStream` calls it **unconditionally** (`:145`) and only *then* starts `runPane` when motion is allowed (`:147-149`). So with motion on, the rail would paint each pane's **final** sentence and **final** dot for one frame, and `runPane` would immediately replay from step 1 — the rail jumping backwards in front of the reader. The same defect repeats forever: `runPane`'s rest gap resets `index = 0` **without clearing** (`:92-105`), so a `done` rail would flip back to `working` once per loop with nothing seeding it.
  **Decision: whenever a run is about to start, the rail/chip hooks are seeded from the pane's FIRST `tail`/`state`** — once at mount before `runPane`'s first tick, and again at the top of each loop where `index` resets. `renderStaticFrame` keeps applying the **last** values and is what the reduced-motion path, and only it, leaves on screen. One helper, two call sites; `applyStep` stays the single funnel.
- Even though the hook lookup is scoped, **never widen it to `document`**. The scoping is the contract, not a consequence of there happening to be one mount.

### 3.6 The six panels

| # | `PANELS` key | `SCENES` key | shape | plate |
|---|---|---|---|---|
| 1 | `panelRail` | `rail` | `side`, `flip` | `--plate-cloudstudy` |
| 2 | `panelWorktree` | `picker` | `side` | `--plate-valley` |
| 3 | `panelRestore` | `restore` | `wide` | `--plate-clouds` |
| 4 | `panelSurfaces` | `surfaces` | `wide` | `--plate-jamaica` |
| 5 | `panelUsage` | `usage` | `side` | `--plate-plateau` *(freed by the grid cut)* |
| 6 | `panelCatalog` | `catalog` | `side`, `flip` | `--plate-cloudstudy` at `background-position: 68% 22%` |

`flip` flags follow the spec exactly (1 and 6 only). There is no source disagreement here, so the spec stands; do not invent an alternation.

**Plate scarcity, decided.** Only six `--plate-*` tokens exist (`tokens.css:51-56`) and the hero owns `--plate-image` (mist). Cutting the `grid` panel frees `plateau`, giving five panel plates for six panels. **Panel 6 reuses `cloudstudy` at a different crop.** This contradicts `tour.css:258-260`'s own comment — *"these five never repeat it or each other"* — so **T20 amends that comment** rather than leaving it asserting something false. Rejected alternative: a seventh plate asset. Encoding a new 30–60 kB painting is scope the spec did not grant, and which painting goes where is an owner choice.

---

## 4. File ownership — one task per file

Two agents editing one file collide. This table is the contract; if a task needs a file it does not own, it stops and the work moves.

| File | Owner | Notes |
|---|---|---|
| `marketing/stage/stage-data.js` | **T1** | additive only |
| `marketing/stage/appwin.js` | **T2** | additive only |
| `marketing/landing-prototype/src/agent-strip.js` | **T3** | |
| `marketing/landing-prototype/styles/tokens.css` | **T4** | |
| `marketing/landing-prototype/src/product-stage.js` | **T5** | |
| `marketing/landing-prototype/src/appwin.js` (shim) | **T5** | |
| `marketing/landing-prototype/src/tour/panel-scenes.js` | **T6** | |
| `marketing/landing-prototype/src/tour/scenes/chrome.js` *(new)* | **T6** | |
| `marketing/landing-prototype/src/tour/scenes/{rail,picker,restore,surfaces,usage,catalog}.js` *(new)* | **T6** creates → **T11–T16** own one each | sequenced across Phase 3 → Phase 4 |
| `marketing/landing-prototype/src/directions/a.js` | **T7** | |
| `marketing/landing-prototype/src/tour/index.js` | **T8** | |
| `marketing/landing-prototype/src/tour/stage-states.js` | **T8** | |
| `marketing/landing-prototype/src/copy.js` | **T9** | |
| `marketing/landing-prototype/src/main.js` | **T10** | |
| `marketing/video/src/main.js` | **T10** | the only file under `marketing/video/` this plan touches |
| `marketing/landing-prototype/styles/appwin.css` *(new)* | **T10** creates → **T17** owns after | sequenced across Phase 2 → Phase 4 |
| `marketing/landing-prototype/styles/direction-a.css` | **T10** (extraction) → **T18** (monograms) | sequenced across Phase 2 → Phase 4 |
| `marketing/landing-prototype/styles/scenes.css` | **T19** | |
| `marketing/landing-prototype/styles/tour.css` | **T20** | |
| `marketing/landing-prototype/src/stage-markup.test.js` *(new)* | **T21** | the consolidated seam test (§6) |
| `scripts/capture-landing-stage.mjs` *(new)* | **T21** | gate 2's capture script (§6). Repo-root `scripts/`, matching the two ad-hoc capture scripts already there |
| `<owned file>.test.js` *(new, one per task)* | **the task that owns `<owned file>`** | see §4.1. T21 absorbs and deletes them |
| `AGENTS.md`, `docs/CONTEXT.md`, this plan | **T21** | |

**Untouched on purpose:** `marketing/stage/brand.js`, everything else in `marketing/video/`, `marketing/landing-prototype/styles/{base,frame,changelog}.css`, `vite.build.mjs`, all of `src/` and `electron/`.

**Two merges made to avoid collisions:**
- The Cursor monogram's **CSS** is split by *sheet*, not by feature. T3 emits class names and styles nothing. **T18 owns `.agent-strip__mark--mono` and only that** — the 20px strip mark, in `direction-a.css`. **T19 owns every `.scene-*__mark--mono`** — `scene-restore__mark` (`panel-scenes.js:99`), `scene-rail__mark` (`:191`), `scene-picker__mark` (`:259`), `scene-surfaces__tabmark` (`:336`) — because those classes are styled in `scenes.css`, which is T19's file. An earlier draft gave T18 "the same treatment for the scene-side sizes", which would have put scene rules in the page sheet and split one visual treatment across two owners. **The size set is 20 (strip) / 18 (existing scenes) / 15 (T16's catalog rows)** — `agentMark` emits `width/height="18"` and the picker's inline `<img>` is 18 as well; 15 belongs to the catalog alone.
- The **six scenes' CSS** all lives in one `scenes.css`, so T19 owns it alone and is sequenced after every scene body. This is the plan's one deliberate serialization. The honest cost of *not* splitting is that `scenes.css` lands near **830 lines**, past spec §5's own size guidance — `max-lines` is a lint **warning** in this repo, so nothing enforces it, and the file stays readable because it is six labelled blocks. The honest cost of splitting is not "six new `main.js` imports" (an earlier draft's argument against a six-way split nobody proposed): one extra sheet is **one** import, in a file T10 already owns. It is not split because a second sheet would need its own owner and its own place in the cascade for no reader's benefit.

### 4.1 How lanes actually run — decided, because parallel agents will act on it

Three questions the task list leaves open otherwise. All three are settled here.

1. **Lanes share ONE working tree, on the one branch this plan names.** No `git worktree` per lane. §4's one-file-one-owner table is what keeps concurrent lanes apart; a second tree would buy isolation the ownership table already provides and cost a merge per phase. **Consequence, stated because it contradicts R16 as first written:** in a shared tree `git status --short` is *expected* to be dirty with other lanes' files, so "confirm no other lane's files are dirty" is not a runnable check. R16's check is restated as: **before starting, confirm no file on YOUR Files line is already dirty** — that, and only that, means another agent is in your file.
2. **`npm run build:landing` is a PHASE gate, not a task gate.** It bundles the whole tree, so in a shared tree it reports every lane's half-finished work, not yours. Where a task's acceptance says "`npm run build:landing` clean", read it as: *the phase is not done until this passes*. Run it at phase end, once, before the next phase starts. A task's own acceptance is the assertions it can make about **its own files**.
3. **A task that needs a test harness writes one, next to its own file.** `stage-markup.test.js` belongs to T21 and is written LAST, so T2, T3, T5 and T11–T16 would otherwise have markup assertions with nothing to run them in. Each such task **adds one `*.test.js` beside the file it owns** (`appwin.test.js` next to `marketing/stage/appwin.js`, and so on), owns it like any other file, and asserts only against its own module. **T21 then consolidates the seam assertions into `stage-markup.test.js` and deletes the per-task files it absorbs.** Two facts make this the shape rather than a shared stub file: a shared stub is a shared file, which is exactly the collision §4 exists to prevent; and **`agent-strip.js` cannot be imported by plain Node** — it fails with `Unknown file extension ".png"` on `src/assets/agent-agy.png`, measured at HEAD — so T3's assertions need Vitest's Vite transform specifically. Run them with `npx vitest run marketing/`, never `node -e`. (`marketing/stage/stage-data.js` and `marketing/stage/appwin.js` *do* import cleanly under plain Node, which is why T1's and T2's `node -e` acceptance commands work as written.)

---

## 5. Tasks

### Phase 1 — Data, renderers, marks, tokens
*Lanes A/B/C/D run concurrently. Four disjoint files, zero shared imports between them. Nothing here depends on anything here.*

---

**T1 — `stageRail` and `stageStrip`, and the step-carried rail fields** · lane A · depends on: nothing

**Files:** `marketing/stage/stage-data.js`

**Changes:**
- Add `stageRail` and `stageStrip` per §3.1, both `deepFreeze`d.
- **Keep `stageSidebar` and `stageStatus` exactly as they are.** Do not rename, do not delete. Add a one-line comment on each: *"video-only since 2026-08-20; the landing composition no longer renders it."* Rationale in T5 and §7.
- Add `tail` / `state` to steps in `stagePanes`. The three transcript scripts, their timings, footers and classes are **unchanged** (spec §2).
  - `claude` — step 1 `state:"working"`, `tail:"I'll trace why the pane divider drifts on resize."`; step 6 `tail:"The ratio rounds to integer cells before the flex pass."`; step 11 `state:"done"`, `tail:"214 tests passed — the divider stays put now."`
  - `codex` — step 1 `state:"working"`; step 4 `tail:"The old pane's canvas paints one frame after the grid reflows."`; step 9 `state:"done"`, `tail:"96 passed · 0 failed"`
  - `opencode` — step 1 `state:"working"`; step 3 `tail:"The watcher only re-reads HEAD on focus."`; step 8 `state:"done"`, `tail:"typecheck clean · the branch follows cwd now"`
  - Tails carry **no glyph prefix** (`●`, `✓`, `›`) — the rail prints the sentence, not the transcript row.
- Hero fixture: three clusters. `spacevibe-deck` → one `framed: true` tab of three panes `{claude working, codex done, opencode done}` with ids matching the pane ids. `spacevibe-api` → one bare tab, one pane, `state:"asked"`, `id: null`, a **question** as its tail. `spacevibe-hub` → `remembered: true`, `tabs: []`. **No cluster is `collapsed` and none is `hovered`** (D6).
- `stageStrip` fixture: active terminal chip `{agent:"claude", paneId:"claude", label:"<claude's opening tail>"}` (D11), inactive file chip `{kind:"file", label:"layout-engine.ts"}`, inactive browser chip `{kind:"browser", label:"localhost:5173"}`. **No `glyph` field** — the mark comes from `kind` alone (§3.1). Order is **open sequence** (`agent-rail-model.ts:384`, `:396` — explicitly not recency).

**Ages** are `"" | now | 2m | 3h | 2d | 5w` — **weeks are the largest unit** (`agent-rail-model.ts:548-568`). Never write months.

**Acceptance:** `node -e 'import("./marketing/stage/stage-data.js").then(m => console.log(Object.keys(m)))'` prints all six exports; every `pane.id` referenced by a `stageRail` pane or a `stageStrip` chip exists in `stagePanes`; every `state` is one of the five; `Object.isFrozen(stageRail)` is true.

---

**T2 — the three new renderers** · lane B · depends on: nothing *(reads shapes from §3.1, not from T1's code)*

**Files:** `marketing/stage/appwin.js`

**Changes:**
- Add `renderStageFrameRow`, `renderStageRail`, `renderStageStrip` per §3.2/§3.3.
- **Keep `renderStageSidebar`, `renderStageStatus`, `renderStageTitlebar`** — the video calls all three (`stage-driver.js:105, 111` and `renderStageTitlebar` via `renderStageSidebar`). Removing `renderStageStatus` alone would break eight call sites.
- `STAGE_ICONS` gains `sidebar` (SidebarSimple, **filled** — it is in `SOLID_ICONS`, `deck-icon.tsx:38`), `plus`, `dots` (**DotsThreeOutline, filled** — never `DotsThree` at fill, `src/ui/toolbar/feature-toolbar.tsx:235-249`), `globe`, `file`, `close`, `folder`, `caret`, `refresh`. The existing five stay untouched: the video's `renderStageTitlebar` reads them. `file` and `globe` are what the file and browser chips draw in their mark slot — there is no text glyph (§3.1).
- **Frame row** (`desktop-chrome.tsx:70-112`, `sidebar-toggle.tsx:99-109`): traffic lights → sidebar toggle → `New` (glyph + the word) → drag spacer, **and nothing else**. `app.tsx:1390` confirms `toolbar={sidebar ? null : chromeActions}` — in sidebar mode the frame row carries **no** feature toolbar.
- **Rail:** the cluster header is a **three-track grid holding two direct children**, not four — §3.3 rule 4, which is the contract T17 styles against. A live header emits `.a-appwin__clustertoggle` (folder + name + caret inside it, spanning `1 / -1`) and `.a-appwin__clusteradd`. A `remembered` header emits `.a-appwin__clusterstill` (folder + name, **no caret element at all**, `04a:228-239`) plus `.a-appwin__clusteradd` and `.a-appwin__clusterremove`. The `×` renders only for a remembered cluster. `is-hover` is a class the *data* asks for and only scenes set it — the live page's own hover is CSS (§1.1), not markup.
- **Row vs leaf:** a `framed` tab emits `.a-appwin__item.is-framed` wrapping N `.a-appwin__leaf` buttons and **no parent row** (D7). A bare tab emits `.a-appwin__item` wrapping one `.a-appwin__row`. **The two have different child class names** — `__rowmark`/`__rowmsg`/`__rowage`/`__rowlogo` against `__leafmark`/`__leafmsg`/`__leafage`/`__leaflogo` (§3.3 rule 5) — because the app's own asymmetry has to be reproducible: the leaf's age is `--text-muted` while the tab row's age is `--text-faint` (`04b:272-275` vs `04a:522-533`). The shared `a-appwin__mark` class rides beside `__rowmark`/`__leafmark` and carries the painting.
- **Identity vs sentence differ by tone alone** — both are `450 var(--type-body)/1.25`, primary vs muted (`04a:505-578`). Do not reach for weight or size.
- **Mark:** `renderStageRailMark(state, paneId)` always emits the 8-circle spinner SVG inside the mark span (§3.3 rule 2). Circles carry `class="a-appwin__wsdot" style="--dot:N"` for **N = 0…7, ZERO-BASED** — `workspace-spinner.tsx:54` is `style={{ "--dot": String(i) }}` with `i` zero-based, and T17 copies `animation-delay: calc((var(--dot) - 8) * 0.15s)` verbatim. At 1…8 the last dot's delay is `0s`, none gets `-1.2s`, and the ring **pops in** on first paint — which is precisely what `02-shell.css:454-459` says the negative delays exist to prevent. The whole phase distribution shifts one slot too.
- **Strip:** chips per `kind`; the active terminal chip gets `is-active`, its label carries `data-tail`, and its close glyph renders (visible on `.is-active` as well as hover, `05-tab-bar-toolbar.css:169-172`). Trailing order is `+` → `⋯` → panel toggle (`app.tsx:1462-1509`; `DockToggle` is present by default **because** `dockOpen: false`).
- **A terminal chip shows no colour dot, no attention mark and no rename affordance** (`tab-strip.tsx:130-141`, `:9-13`, `:11-13`). Do not add them back "for life".

**Acceptance:** each renderer returns a string for its fixture and for an empty array; the output contains no literal `undefined` or `[object Object]`; a **live** cluster header contains exactly one `a-appwin__clustertoggle` and one `a-appwin__clusteradd` and no other direct child; `renderStageRail` of a `remembered` cluster contains `is-still`, one `a-appwin__clusterstill`, and **no** `clustercaret` anywhere; `renderStageRail` of a `framed` tab contains exactly N `a-appwin__leaf` and zero `a-appwin__row`; every `--dot` value emitted is in `0…7`; no `document.` appears anywhere in the file. Assertions go in `marketing/stage/appwin.test.js`, which this task owns (§4.1); `node -e` also works for this file.

---

**T3 — Cursor joins the marks, behind one shared renderer** · lane C · depends on: nothing

**Files:** `marketing/landing-prototype/src/agent-strip.js`

**Changes:**
- `AGENT_MARKS` gains a sixth entry, **last**: `{ id: "cursor-agent", label: "Cursor", mark: null }`.
  - The id is **`cursor-agent`, not `cursor`** (`agent-catalog.ts:88-95` — the file is 317 lines; an earlier draft cited a line it does not have). The label is **"Cursor"** — that is the catalog's `label`; an earlier plan wrote "Cursor Agent" and the source disagrees.
  - Last on purpose: order is the digit-key contract (`agent-catalog.ts:84-88`).
  - `mark: null` because `AGENT_LOGOS` (`agent-logos.ts:25-31`) has exactly five keys and `cursor-agent` is absent. **No asset is created** (spec §7).
- Export **one** shared helper and route all three bare-`<img>` renderers through it:
  ```
  renderAgentMark(agent, className, size)  // <img …> when agent.mark, else the monogram span
  ```
  Monogram markup: `<span class="${className} ${className}--mono">C</span>`. The letter is `letterAvatar`'s output — first alphanumeric of the id, uppercased (`letter-avatar.ts:11-18`) → **"C"**.
  **No tint.** The app hashes a `TAB_DOT_COLORS` token from the id; nothing in `marketing/` has that table, and inventing a colour would be a brand claim. Neutral ink on a neutral disc, styled by T18. Recorded as a knowing simplification.
- Three call sites collapse onto the helper: `renderAgentStrip` (**size 20**), and — after T6 — the scene helper (**size 18**: `agentMark` emits `width/height="18"`, and the picker's own inline `<img>` at `panel-scenes.js:259` is 18) and T16's catalog rows (**size 15**). This task changes only the first; the other two consume the new export in Phase 4. **The CSS is split by sheet, not by size:** T18 styles `.agent-strip__mark--mono` only; every `.scene-*__mark--mono` is T19's (§4).
- **Named transient.** This task changes `renderAgentStrip` and nothing else, so the picker's inline `<img>` survives T6's verbatim move and is not routed through the helper until **T12**. Between Phase 1 and Phase 4 the picker scene therefore renders `src="null"` for the Cursor row. It is loud in devtools, invisible in a build, and closes in T12 — recorded so nobody "fixes" it inside T6's verbatim move or T12's neighbour's file.

**Acceptance:** `AGENT_MARKS.length === 6` with `cursor-agent` last; `renderAgentStrip(copy)` returns markup containing six chips and exactly one `--mono` span, and contains no `src="null"` and no `src="undefined"`. **Run under `npx vitest run marketing/`, not `node`** — `agent-strip.js` imports `src/assets/agent-agy.png` and plain Node fails with `Unknown file extension ".png"` (§4.1). Assertions go in `marketing/landing-prototype/src/agent-strip.test.js`, which this task owns.

---

**T4 — the colour re-derivation** · lane D · depends on: nothing

**Files:** `marketing/landing-prototype/styles/tokens.css`

**Changes:** apply §2.1 and §2.2 verbatim. Replace the block comment at `:64-68` — it currently says *"Tokyo Night app-window chrome … held at 60% of its original saturation"*, which stops being true — with a comment naming `deck-dark`, the pinned `#272d31` literal, the plane inversion (stage is the deepest surface), and **the video consequence in §2.4**.

**Acceptance:** `grep -o '\-\-sg-[a-z0-9-]*:' marketing/landing-prototype/styles/tokens.css | wc -l` → **20** (9 rewritten + 11 new). Count *declarations*, not lines: `grep -c` counts matching **lines**, so the new block comment — which this task must also write, and which names `--sg-rail` and `--sg-hairline-soft` — would silently inflate the number. `npm run build:landing` is the phase gate (§4.1), not this task's; no `color-mix` remains in the `--sg-*` block except where an alpha is intended.

---

### Phase 2 — Seams, copy and the sheet split
*Lanes A/B/C concurrent. Three disjoint file sets. Nothing here depends on anything here — every dependency is in Phase 1.*

---

**T5 — barrel, shim, and the stream engine's rail hooks** · lane A · depends on: T1, T2

**Files:** `marketing/landing-prototype/src/product-stage.js`, `marketing/landing-prototype/src/appwin.js`

**Changes:**
- **`product-stage.js:11-18`** — import and re-export `stageRail` and `stageStrip` alongside the existing four. **`stageSidebar` and `stageStatus` stay on that line.** This is the second export barrel spec §5 never named; removing a name here is an immediate ESM link error in the **landing** build, not just the video.
- **`marketing/landing-prototype/src/appwin.js` (the 17-line shim)** — add `renderStageFrameRow`, `renderStageRail`, `renderStageStrip` to the re-export list. Spec §5 never names this file, and every landing `../appwin.js` import misses anything not listed here. Keep `BRAND_ICON_SRC` — `changelog-view.js:1` imports it through this shim.
- **`mountStageStream`** — the `{ chromeRoot }` option, the `querySelectorAll` hook resolution, the tolerated-miss rule, and `applyStep`'s two new fields, all per §3.5.
- **`renderStaticFrame`** — widen to apply `tail`/`state` from every step kind in order, per §3.5. **This is the reduced-motion gate (spec §8.4); it is not optional.**
- **The animated seed**, per §3.5. Widening `renderStaticFrame` without it makes the animated path start at the END: `mountStageStream` calls `renderStaticFrame` unconditionally (`:145`) before starting `runPane` (`:147-149`), so the rail would show each pane's final sentence and dot for one frame and then jump backwards to step 1 — and again on every loop, because the rest gap resets `index = 0` without clearing (`:92-105`). Seed the hooks from the pane's **first** `tail`/`state` at both points.
- The existing throw behaviour for `gridRoot`, `[data-lines]` and `[data-spinner]` is unchanged.

**Acceptance:** re-export line names all six data exports and the shim names all ten renderers; a jsdom mount with a `[data-tail]`/`[data-dot]` node present sets both after the scripted steps; a mount with **no** rail nodes present completes without throwing; under `prefers-reduced-motion: reduce`, the mark's `data-state` equals the pane's **last** `state` and the `[data-tail]` text equals its **last** `tail`; **and with motion ALLOWED, the frame immediately after mount carries the pane's FIRST `state` and FIRST `tail`, not its last** — the animated path is asserted, not only the reduced-motion one. Assertions go in `marketing/landing-prototype/src/product-stage.test.js`, which this task owns (§4.1).

---

**T9 — copy, EN and VI** · lane B · depends on: nothing *(the panel list is fixed in §3.6)*

**Files:** `marketing/landing-prototype/src/copy.js`

**Changes:** flat sibling keys per locale — the file is a flat string map, not nested objects.
- **Add** `panelUsageTitle` / `panelUsageBody` and `panelCatalogTitle` / `panelCatalogBody` in **both** locales.
  - Panel 5's body names **⌘⇧U** (D5) and the local-corpus angle: reads `~/.claude` and `~/.codex` on your own machine, no account, no upload.
  - Panel 6's body describes Installed vs Available and the shipped commands. **It must not mention a default or a star** (D4).
- **Add** `scExplorer` and `scSessions` in both locales (T8's two new chords).
- **Fix `panelRestoreBody`** in both locales: `codex resume --last` → `codex resume` (D3). The line currently promises the *latest* form for a panel that draws the *id* form.
- **Fix `panelRailBody`** in both locales: it says *"Quiet rows dim"* — the owner **withdrew** the quiet-row dimming on 2026-08-19 because live agents read as disabled (AGENTS.md; every row keeps full legibility). Replace with the state vocabulary that is actually true.
- **Rewrite `tourKicker`** in both locales. It reads `"// from folder to full formation"` — **the cut panel's own line**, rendered as the section label at `tour/index.js:440`. New: EN `"// what the window already does"`, VI `"// những gì cửa sổ đã làm được"`.
- **Delete** `tourCh1Title/Body`, `tourCh2Title/Body`, `tourCh3Title/Body` from **both** locales. `tourCh1*` and `tourCh3*` were already dead; `tourCh2*` dies with the grid panel.

**Ordering note (was an interlock).** T9 and T8 are **not** concurrent, and they used to be. They are interlocked in both directions: T9 deletes `tourCh2*` while T8 deletes the panel that reads it, and T8 adds the `panelUsage` / `panelCatalog` entries whose copy T9 adds. Either order renders `undefined` somewhere until both land. Putting T9 a full phase ahead of T8 resolves it by ordering rather than by coordination — **and it means no screenshot taken between them means anything.** Gate 2 runs after Phase 5, not before.

**R1 note:** the repo is English-only for code, comments, docs and commits. `copy.js`'s `vi` map is the landing's shipped localization and is the **one** place non-English strings live. **Scene-internal strings stay English** (spec §2, the 2026-07-16 stage spec) — a rail sentence, a command, a column header and a key hint are never translated.

**Acceptance:** `Object.keys(messages.en).sort()` deep-equals `Object.keys(messages.vi).sort()`; every `PANELS` key has a `Title` and a `Body` in both; `grep -n "tourCh" marketing/landing-prototype/src/copy.js` → no hits; `grep -n "from folder to full formation" marketing/landing-prototype/src/` → no hits.

---

**T10 — extract the appwin sheet** · lane C · depends on: T4

**Files:** new `marketing/landing-prototype/styles/appwin.css`, `marketing/landing-prototype/styles/direction-a.css`, `marketing/landing-prototype/src/main.js`, `marketing/video/src/main.js`

**Decision: split, unconditionally.** Spec §5 left it conditional. The rework roughly doubles a block that is already 408 contiguous lines inside a 1526-line file — frame row, rail (clusters, rows, leaves, the inset frame, four dot states, the spinner), strip (three chip kinds, three trailing controls), the 390px strategy and reduced motion. The split is mechanical and the extraction is provably clean: **all 70 `.a-appwin` occurrences in `direction-a.css` fall inside the four ranges below**, so the file is left with zero `.a-appwin` selectors.

**Move, verbatim:**
- `:484-891` — the whole appwin block (contiguous, self-contained).
- `:1235-1245` — `@keyframes a-appwin-blink`, `a-appwin-pulse`.
- **`:1344-1375`** — the appwin rules **inside** `@media (max-width: 47.5rem)`. **Re-wrap them in their own `@media (max-width: 47.5rem)` in the new file.** The range ends at **1375**, not 1377: the last narrow appwin rule closes at `:1375`, and `:1377-1378` is `.a-actions`' own comment. Taking `:1377` strands a bare `*/` in `direction-a.css`, which CSS error-recovery then eats forward from — a silent, wide loss with no build failure.
- **`:1425-1428`** — the selectors **inside** `@media (prefers-reduced-motion: reduce)`. **Re-wrap likewise.** The rule runs to `:1428`, not `:1426`.

~450 lines move; `direction-a.css` lands near 1076.

**Register in BOTH entries — this is the trap:**
- `marketing/landing-prototype/src/main.js` — insert `import "../styles/appwin.css";` immediately after `tokens.css` (line 1). Sheets are registered by JS import order; `index.html:15` links only `base.css`. Placing the shared chrome sheet ahead of the three page sheets preserves today's cascade direction (a page sheet can still override).
- **`marketing/video/src/main.js:10` imports `../../landing-prototype/styles/direction-a.css`** — the video's `.a-appwin*` styling comes from the landing's sheet. Insert `import "../../landing-prototype/styles/appwin.css";` **immediately after** that line, keeping `video.css` last so its overrides still win. **Registering only the landing entry silently un-styles the entire video stage** — no error, no build failure, just a naked mock.

The moved rules read `--sg-*` (from `:root`) and `--a-font-display` / `--a-font-mono` (from `.direction-a` / `.tour` / `.vid-frame`), so the new sheet has **no token deps of its own** — but its import must come after `tokens.css` in both entries.

**Acceptance:** `grep -c "a-appwin" marketing/landing-prototype/styles/direction-a.css` → 0; `npm run build:landing` clean; the built CSS bundle contains the same appwin rules as before the move (`grep -c "a-appwin" marketing/landing-prototype/dist/assets/*.css` unchanged); the video entry renders a styled window.

---

### Phase 3 — Scene modules and the hero
*Lanes A/B concurrent. Two disjoint file sets. Both consume T5's widened shim and neither consumes the other.*

---

**T6 — split the scenes into modules and rebuild the shared chrome** · lane A · depends on: T2, **T5**

**Files:** `marketing/landing-prototype/src/tour/panel-scenes.js`, new `marketing/landing-prototype/src/tour/scenes/chrome.js`, new `marketing/landing-prototype/src/tour/scenes/{rail,picker,restore,surfaces,usage,catalog}.js`

**Why split:** `panel-scenes.js` is 391 lines today and the rewrite plus two new scenes puts it near 800. More importantly, **six panels in one file is the plan's largest collision** — the split is what turns Phase 4 into six independent lanes. Spec §5 already contemplates the same move for the CSS.

**Why this depends on T5, and why it is in Phase 3 rather than beside it.** §3.4 requires `scenes/chrome.js`'s `frame()` to call `renderStageRail` / `renderStageStrip`, and the landing idiom reaches those **through the shim** — `panel-scenes.js:16` imports from `"../appwin.js"` today, and that shim re-exports exactly seven names (`marketing/landing-prototype/src/appwin.js:8-16`). Adding the three new ones is **T5's** job. Until T5 lands, `import { renderStageRail } from "../../appwin.js"` is a Rollup link error, so this task could not have passed a build gate while a declared-concurrent sibling was unfinished. **Do not work around it by importing `../../../../stage/appwin.js` directly** — keeping that path out of landing modules is the whole reason the shim exists.

**Changes:**
- `scenes/chrome.js` exports `frame(body, { rail, strip })` per §3.4, plus `SCENE_RAIL` — one compact shared rail fixture (two clusters, four rows) that scenes not *about* the rail can pass without inventing their own.
- **`frame()` no longer calls `renderStageSidebar` or `renderStageStatus`**, and **`chrome.js` must not import `stage-states.js`.** Both are what let T8 delete `SIDEBAR_STATUS` cleanly.
- `agentMark()` leaves this file; scenes import `renderAgentMark` from `../../agent-strip.js` (T3). Today's `agentMark` has **no null guard** and throws on an unknown id — the helper is what fixes that for all three call sites.
- Move each existing scene body verbatim into its own module (`rail.js`, `picker.js`, `restore.js`, `surfaces.js`), each exporting one zero-argument `() => string`. **Do not change their contents in this task** — Phase 4 does that. A verbatim move keeps this task's diff reviewable.
- Create `usage.js` and `catalog.js` as minimal placeholders returning `frame("")`.
- `panel-scenes.js` shrinks to imports plus `export const SCENES = { rail, picker, restore, surfaces, usage, catalog };`

**Acceptance:** `Object.keys(SCENES)` is exactly those six; every value is a zero-argument function returning a string; `grep -rn "stage-states" marketing/landing-prototype/src/tour/scenes/` → no hits; **`grep -rn "renderStageSidebar\|renderStageStatus" marketing/landing-prototype/src/tour/scenes/ marketing/landing-prototype/src/tour/panel-scenes.js` → no hits.** The grep is scoped to this task's own files on purpose: `tour/index.js:16-17` still imports both names and still calls them at `:298` and `:301` inside `renderBoard` / `renderScene`, and **those die in T8, not here** — a repo-wide grep returns five hits at this task's completion, and an agent driving it to zero would edit `tour/index.js`, which §4 assigns to T8. That half of the assertion lives in T8's acceptance. `npm run build:landing` is the phase gate (§4.1).

---

**T7 — the hero** · lane B · depends on: T2, T5

**Files:** `marketing/landing-prototype/src/directions/a.js`

**Changes:**
- Imports: `renderStageRail`, `renderStageStrip` from `../appwin.js`; `stageRail`, `stageStrip` from `../product-stage.js`. **Drop `renderStageSidebar` and `renderStageStatus`** from this file's imports — they stay exported, they are just no longer called here.
- Replace the stage composition (`:185-202`) with §3.4. The pane split stays as today — `claude` + `codex` share `.a-appwin__col`, `opencode` is a bare grid child. (The **video's** split differs — claude alone left — and is not this plan's business.)
- `mount()` passes the chrome root: `mountStageStream(section.querySelector(".a-appwin__grid"), { chromeRoot: section.querySelector(".a-appwin") })`.
- Everything else in the file — topbar, pill, headline, CTAs, `renderAgentStrip` mounted *inside* the hero section on purpose (`:204-207`), `updateDirectionALocale` — is untouched (spec §4).

**Acceptance:** the rendered hero contains exactly one `.a-appwin__sidebar`, one `.a-appwin__stage` **immediately after it**, one `.a-appwin__strip`, zero `.a-appwin__status`, zero `.a-appwin__wsitem`; three `[data-stream]` regions; every `[data-tail]` value matches a `[data-stream]` id.

---

### Phase 4 — Registry, scene bodies and chrome styles
*Nine lanes, all concurrent. The six scene modules (created and frozen by T6), the tour registry, and two disjoint stylesheets. Nothing here depends on anything here.*

---

**T8 — cut the `grid` panel, rewrite `PANELS`, extend the finale** · lane A · depends on: T6, T9

**Files:** `marketing/landing-prototype/src/tour/index.js`, `marketing/landing-prototype/src/tour/stage-states.js`

**Changes — `tour/index.js`:**
- `PANELS` becomes the six rows of §3.6.
- Delete the special case at `:203` — `panel.scene === "grid" ? renderScene(2) : SCENES[panel.scene]()` becomes `SCENES[panel.scene]()`. **The `grid` panel was never a `SCENES` entry**; it was this ternary.
- Delete the whole stranded chain: `renderScene` (`:280`), `renderBoard` (`:260`), `renderBoardRecent` (`:245`), `renderPresetThumb` (`:239`), `renderAgentChip` (`:233`), and the now-unused imports of `AGENTS`, `PRESET_CELLS`, `SIDEBAR_STATUS`, `boardRecents` (`:26-30`).
- **Delete the `.tour__scenegrid` stream mount as a PAIR: `:457-462` AND `:470-472`.** `disposeStreams` is declared at `:460-462` and **consumed** at `:470-472` (`for (const dispose of disposeStreams) { dispose(); }`), inside the tour's own disposer — which `main.js:23`/`:31` calls on every locale switch. Deleting the declaration alone leaves a live reference error that **Rollup will not fail on**: the landing builds, and switching language throws. After the cut no tour scene emits `[data-stream]` markup; `querySelectorAll` over a class nothing renders is a trap for the next reader, not a seam. `mountStageStream` then has exactly one call site — the hero. Its `chromeRoot` scoping stays anyway (§3.5).
- **Delete the WHOLE of line 24**, not just one name: it is `import { mountStageStream, stagePanes } from "../product-stage.js";` and `stagePanes`' only use is `:281`, inside the deleted `renderScene`.
- **Delete `renderStagePane`, `renderStageSidebar` and `renderStageStatus` from the `../appwin.js` import (`:15-17`)** — an earlier draft never named them. Their only uses are `:288-291`, `:298` and `:301`, all inside the deleted chain. **`BRAND_ICON_SRC` (`:14`) MUST STAY** — it is used at `:409`.
- Finale shortcuts (`:318-325`) gain two rows: `["⌘⇧B", "scExplorer"]` and `["⌘⇧Y", "scSessions"]` → eight chords. **D5 confirms both.**

**Changes — `stage-states.js`:** delete `AGENTS` (`:17-21`), `boardRecents` (`:24-49`, already dead — nothing called `renderScene(1)`), `PRESET_CELLS` (`:52`) and `SIDEBAR_STATUS` (`:58-62`). Keep `PROOF_TERM_STEPS` (`:69-95`) and only the imports it still needs. The file becomes the closing band's terminal script and nothing else.

**Acceptance:** `grep -rn "renderScene\|boardRecents\|PRESET_CELLS\|SIDEBAR_STATUS\|tour__scenegrid\|disposeStreams\|stagePanes" marketing/landing-prototype/src/tour/` → no hits; **`grep -rn "renderStageSidebar\|renderStageStatus" marketing/landing-prototype/src/tour/` → no hits** (this is the half of T6's assertion that had to wait for this task — until now `tour/index.js` still imported and called both); `grep -n "BRAND_ICON_SRC" marketing/landing-prototype/src/tour/index.js` → still present; `PANELS.length === 6` and every `panel.scene` is a key of `SCENES`; the finale renders eight `.tour__sc`; switching locale in the browser does not throw.

---

**T11 — panel 1, `rail`** · lane B · depends on: T3, T6

**Files:** `marketing/landing-prototype/src/tour/scenes/rail.js`

Rail column zoomed, stage side dimmed with the "the panes keep running" hint. Four clusters, covering **every** rail state the app has, all in legitimate resting frames:

1. Live, `framed: true` — three leaves: one `working` (the 14px ring), two `done` (**quiet gray dots**, D1). No parent row (D7). No selection wash on the framed item.
2. Live, bare — one `failed` row (red) and one `asked` row (yellow), each with its sentence and age.
3. **Collapsed** — caret **visible** (the one resting state in which it is, `04a:355-366`), no rows.
4. **Remembered**, `hovered: true` — `.asr-cluster__still`: folder + name, **no caret ever**, with `+` and `×` revealed. This is the plan's single baked hover state, and it is where the `+` gets said (D6).

Uses `renderStageRail` through `frame(body, { rail: <this fixture> })` — the scene does not hand-roll rail markup. Panel 1 is `flip: true`, so the rail sits on the reader's right.

**Acceptance:** the scene contains all five `data-state` values across its marks; exactly one `is-hover`; exactly one `is-collapsed`; exactly one `is-still` and it contains no `clustercaret`.

---

**T12 — panel 2, `picker`** · lane C · depends on: T3, T6

**Files:** `marketing/landing-prototype/src/tour/scenes/picker.js`

⌘T quick picker over a blurred scrim. Verbatim from `agent-quick-picker.tsx:235-362` and `10-modals.css:255-314`:
- Panel: `width: min(420px, 90vw)`, `padding: 16px`, ground `--sg-rail`, `1px solid var(--sg-seam-raised)`, `border-radius: 12px`. Scrim: 42% wash of `--sg-bg` + `blur(10px)`.
- `<h1>Open a new tab</h1>` at 14px.
- **Destination row** — label `Worktree`, value `folder · branch` with a **middle dot U+00B7 and spaces on both sides** (`worktree-destinations.ts:79-83`), and a `CaretDown` hint. It is a **menu value**, not a text field.
- **Six agent rows**, a **column** not a wrapped grid (`.agent-quick-picker .agents { flex-direction: column }`), in `BUILTIN_AGENTS` order, each brand mark + the label text (`Claude Code`, `Codex`, `OpenCode`, `Antigravity`, `Gemini CLI`, `Cursor`), digit `index + 1`. Cursor is row **6** with the monogram — the digit contract is why it is last. The picker maps `AGENT_MARKS` directly, so T3 supplies the sixth row for free; **this task's job is to route it through `renderAgentMark`**, which both stops the markless entry throwing and closes T3's named transient — until this task lands, the picker renders `src="null"` for Cursor.
- **Rows 4–6 are drawn MISSING** — `.achip.is-missing`: dashed border, `--sg-fg-faint` ink, the app's "opens Settings" state. Two panels, one machine, one story: panel 6 counts **3 detected / 3 agents**, so a picker offering six freely launchable agents on the same imaginary machine contradicts it. Marking the undetected three is the cheaper half of the fix; the alternative — making T16's counts 6/0 — would throw away two verbatim source strings.
- **The shell row.** `<button class="achip is-shell"><span class="shellmark">$</span>Shell only</button>`. The spec did not ask for it — but the key line literally says `0 shell`, and a key line naming a row that is not drawn is a lie.
- **The key-hint line, verbatim** (`:359-362`): `1–9 pick · 0 shell · ↑↓ Enter · Esc close`. **The dash between 1 and 9 is an EN DASH**; separators are `·`. The line is `--sg-fg-faint` and the `<kbd>`s inside it are **one step brighter** at `--sg-fg-dim` (`10-modals.css:306-314`). Getting that inversion backwards is the most likely error in this scene.

**Acceptance:** six `.achip` plus one `.is-shell`, of which exactly three carry `is-missing` and they are rows 4–6; digits 1–6 present and `cursor-agent` carries digit 6; the key line contains **one U+2013 and exactly THREE U+00B7** — byte-verified at `agent-quick-picker.tsx:359-362`, the separators sitting after `pick`, after `shell` and after `Enter`; exactly one `--mono` span; **`grep -n 'src="null"' marketing/landing-prototype/src/tour/scenes/picker.js` → no hits** (this check belongs here, not to T3 — T3 only changes `renderAgentStrip`).

---

**T13 — panel 3, `restore`** · lane D · depends on: T6

**Files:** `marketing/landing-prototype/src/tour/scenes/restore.js`

Three panes typing their real resume commands. Per `COMMAND_TABLE` (`agent-resume.ts:39-73`), **id forms**:
- `claude --resume 0f3a91c2` — **no `--dangerously-skip-permissions`** (D3). Already correct in today's code; the spec introduced the error.
- `codex resume 019a4f1c` — changed from today's `codex resume --last`, which is the *latest* form.
- `opencode -s 3b77ae` — already correct.

Everything else in the scene is preserved: `RESTORE_PANES`, the per-element `--scene-delay` / `--scene-steps` inline CSS delays, the `data-restore-line` / `data-restore-type` hooks, and the reuse of `.a-appwin__promptbox` / `.a-appwin__cursor`. Rebuild on the new chrome: `frame(body, { rail: SCENE_RAIL, strip: <three chips> })`, no status bar.

**Acceptance:** the three commands appear exactly as above; `grep -n "dangerously-skip-permissions" marketing/landing-prototype/src/tour/scenes/restore.js` → no hits.

---

**T14 — panel 4, `surfaces`** · lane E · depends on: T3, T6

**Files:** `marketing/landing-prototype/src/tour/scenes/surfaces.js`

Keep the existing shape — unified strip, file tree, editor — and rebuild it on `renderStageStrip` instead of the scene's hand-rolled `SURFACE_TABS` markup, so the panel and the hero draw the same chip.

**New beat (spec §3):** a transcript path line rendered as a ⌘+click link, the editor open at that line. Ground truth is DL-14.7 / DL-23.11 (AGENTS.md 2026-08-20) — a path inside a workspace this window already has open lands in Deck's **own** editor as a preview tab, revealed at its line. Draw: transcript row `● Update(src/terminal/layout-engine.ts:214)` with the path in `--sg-accent`, underlined, and a small `⌘` cue; the editor pane open with row 214 marked. New classes `.scene-surfaces__link` and `.scene-surfaces__line.is-target`. **Do not draw the external-app split button** — it is Electron-only routing and outside the beat.

Note the file-chip detail the app has and the scene should keep: a preview tab's label is italic (`.tab__label--preview`).

**Acceptance:** exactly one `.scene-surfaces__link`; its text matches the editor's marked line number; the strip is `renderStageStrip` output, not hand-rolled.

---

**T15 — panel 5, `usage`** · lane F · **NEW** · depends on: T3, T6

**Files:** `marketing/landing-prototype/src/tour/scenes/usage.js`

**Overview, not Daily** — the full decision and its four reasons are §1.2. Draw the left rail (`Overview · Daily · Breakdown`, Overview active), then Overview's body: eyebrow, the big figure, footnote, the range selector with `All` active, the estimate note, and two per-agent rows (Claude Code, Codex — the only two the scanner covers). Range labels verbatim: `Today · 7 days · 30 days · All`.

**No table. No `<thead>`. No column headers.** Those belong to Daily and Breakdown; the spec's composite does not exist.

`frame(body, { rail: SCENE_RAIL })` — the panel draws the dock's Usage tab, so it keeps the app rail beside it.

**Acceptance:** four range options with exactly one `is-active` and it is `All`; three nav items with exactly one active; zero `<table>`, `<thead>` or `<th>` elements; exactly two agent rows.

---

**T16 — panel 6, `catalog`** · lane G · **NEW** · depends on: T3, T6

**Files:** `marketing/landing-prototype/src/tour/scenes/catalog.js`

Settings → Agents, from `launch-profile-editor.tsx:226-293`:
- `Installed` head + the count pill **`3 detected`** + a Refresh control (`ArrowClockwise` + the word `Refresh`). Count strings are verbatim: **`{n} detected`** and **`{n} agents`**.
- Installed rows, in catalog order: `claude` → `claude --dangerously-skip-permissions`; `codex` → `codex --dangerously-bypass-approvals-and-sandbox`; `opencode` → the bare word **`opencode`** with an **empty flags span** (D9).
- `Available to install` head + **`3 agents`**.
- Available rows, in catalog order: `agy` → `agy --dangerously-skip-permissions`; `gemini` → `gemini --yolo`; `cursor-agent` → `cursor-agent --force`, with the **monogram** (`--force` is the long form of `--yolo`).
- Row shape: mark 15×15 → name (`--type-body`, weight 600) → command with the **binary at primary and the flags at faint** → the **Enabled/Disabled segmented radiogroup**. **No star, no ↗** (D4). Both groups preserve `BUILTIN_AGENTS` order because the split is a `Set` filter over it, not a re-sort.
- The brand mark is deliberately **the one coloured thing** on an achromatic Settings surface (`16-launch-profiles.css:49-53`).

Panel 6 is `flip: true`.

**Acceptance:** six rows in catalog order across two groups; the strings `3 detected` and `3 agents` present; opencode's flags span present and empty; zero occurrences of `star`, `default`, `↗`; each row carries two radios labelled `Enabled` and `Disabled`.

---

**T17 — rail, strip and frame-row styles; the narrow-width strategy** · lane H · depends on: T4, T10

**Files:** `marketing/landing-prototype/styles/appwin.css`

The plan's largest CSS task. Everything is `cqw`-relative — `.a-appwin` is `container-type: inline-size`.

- **Planes:** `.a-appwin` ground `--sg-bg`; `.a-appwin__rail` and `.a-appwin__framerow` ground `--sg-rail`; `.a-appwin__sidebar + *` → `border-left: 1px solid var(--sg-seam-column)`. The rail's top-left corner is seamless with the frame row because both use `--sg-rail`.
- **Rail padding is asymmetric on purpose:** `8px 2px 7px 8px` in the app (`04a:63-72`), scaled to `cqw`. Do not "tidy" it.
- **The stage wrapper is a flex column, and both halves need their zero.** `.a-appwin__stage` takes `display: flex; flex-direction: column; flex: 1; min-width: 0` and `.a-appwin__grid` takes `flex: 1; min-height: 0` inside it. A `border-left` is not enough: without `min-width: 0` a chip label with `white-space: nowrap` blows the flex child out and pushes the whole window wide — R13's own trap, arriving through the new wrapper rather than through the frame.
- **Cluster header grid:** `minmax(0,1fr) 17px 17px`, `gap: 7px`, and **the two trailing tracks stay even when their ink is invisible** (§1.1). The markup is §3.3 rule 4 and this is its other half: `.a-appwin__clustertoggle` spans `grid-column: 1 / -1`; `.a-appwin__clustername` is `min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis`; `.a-appwin__clusteradd` is pinned at `grid-column: 2; z-index: 1`; `.a-appwin__clustercaret` gets `margin-left: 24px` through `.a-appwin__clusterhead:has(.a-appwin__clusteradd)` (`04a:373-375`); `.a-appwin__clusterstill` is `grid-column: 1`; `.a-appwin__clusterremove` is `grid-column: 3; z-index: 1`. **A `margin-left: 24px` on an element placed directly into a 17px track means nothing** — the margin only works because the caret lives inside the spanning toggle.
- **Rest state, and the live reveals (§1.1).** `.a-appwin__clustercaret`, `.a-appwin__clusteradd` and `.a-appwin__clusterremove` are `opacity: 0` at rest, always keeping their 17px boxes — the app reveals ink with `opacity` and never with `display` precisely so the pointer cannot reflow the header (`04a:255-262`). Ported reveals, verbatim in shape from `04a:271-274` and `04a:363-366`: `.a-appwin__cluster:hover .a-appwin__clusteradd`, `.a-appwin__clusteradd:focus-visible`, `.a-appwin__cluster:hover .a-appwin__clustercaret`, `.a-appwin__clustertoggle:focus-visible .a-appwin__clustercaret`, and `.a-appwin__cluster.is-collapsed .a-appwin__clustercaret`. `.is-hover` on a header is the scenes' baked equivalent and reveals the same two.
- **Row geometry:** `17px minmax(0,1fr) auto 17px`, `gap: 2px 7px`, `min-height: 34px`, `padding: 6px 4px 6px 7px` (`04b:17-27`), scaled. Cell 4 holds `__rowlogo` / `__leaflogo`; the reserved `.a-appwin__rowclose` would pin to the SAME cell with `grid-row: 1; grid-column: 4; z-index: 1` (`04a:606-621`) — no fifth column exists. No fixture emits it (§3.3 rule 5).
- **Type:** name and sentence on the **same rung**, differing by tone alone (`--sg-fg` vs `--sg-fg-dim`). Age `--sg-fg-faint` with `font-variant-numeric: tabular-nums` — except the **leaf's** age (`.a-appwin__leafage`), which is `--sg-fg-dim`. The two ages differ by class, which is why §3.3 rule 5 names both.
- **Every rail text rung carries its own floor, and the floor is 9px.** The sheet's idiom is already there — `.a-appwin__line` is `font-size: max(1.15cqw, 7px)` (`direction-a.css:743`) — but 7px is a transcript floor, not a chrome one. `.a-appwin__clustername`, `.a-appwin__rowmsg` / `__leafmsg` and `.a-appwin__rowage` / `__leafage` each get `max(Ncqw, 9px)`. **This is what makes 768 survivable** — see the narrow-width strategy below.
- **The framed item:** `box-shadow: inset 0 0 0 1px var(--sg-hair-strong)`, `border-radius: var(--radius-control)` equivalent, `margin: 3px 0; padding: 3px 0`. **Inset shadow — not a border, not an outline.** The rationale is `04b:86-112`: a border bled the block past its container and `overflow-x: hidden` hid the symptom without removing the scroll container; an outline paints on the 1px *outside* and that same `hidden` clipped it. A headless item paints **no** selection wash and **no** accent bar.
- **The four dot states** (D1): 14px box in every state; `::before` is a centred 9px disc for `failed` / `asked` / `done` / `idle`; `[data-state="working"]` sets `::before { content: none }` and reveals the spinner. Colours per §2.2.
- **`wschase`**, copied from `02-shell.css:444-480`: `@keyframes wschase { from { opacity: 1 } to { opacity: 0.15 } }`, `animation: wschase 1.2s linear infinite`, `animation-delay: calc((var(--dot) - 8) * 0.15s)`. **Nothing rotates** — the geometry is still and a bright head appears to travel because eight dots run staggered opacity ramps.
- **Strip:** `height` = the frame row's height; `border-bottom: 1px solid var(--sg-hairline)` (**D2**, not `--sg-hairline-soft`); `.a-appwin__stripactions { margin-left: auto }`. Chips: a **three-step ladder**, `--sg-tab-rest` at rest → 6% hover → `--sg-raised` + a 1px `--sg-hair-strong` frame when active; a **1px transparent border is always present** so selection costs no height; `border-radius: 2px`; `max-width: 210px`; label `min-width: 0; overflow: hidden; text-overflow: ellipsis`.
- **New icon controls are `.a-appwin__ctl`** (§3.3 rule 6). **T17 must not change a single existing declaration of `.a-appwin__iconbtn`, `.a-appwin__lights`, `.a-appwin__titlebar`, `.a-appwin__actions` or `.a-appwin__actionsep`** — `renderStageTitlebar` still emits all five for the video (`marketing/stage/appwin.js:41-53`), T10 moves their rules into this very sheet, and T10 registers this sheet in the **video** entry. Restyling any of them silently redraws the video's titlebar. Reusing `.a-appwin__lights` unchanged in the frame row is deliberate and free; restyling it is not.
- **Reduced motion** — add to the existing `@media (prefers-reduced-motion: reduce)` block: `.a-appwin__wsdot { animation: none; opacity: 0.5 }` and `.a-appwin__mark[data-state="working"] { opacity: 0.6 }`, mirroring `02-shell.css:474-479`. **Written as the attribute, not as a `--spinner` modifier** — the mock has no such class (§3.3 rule 2), so `.a-appwin__mark--spinner` would match nothing and the gate would pass on a rule that does not exist. Missing this fails spec §8.4.

**The narrow-width strategy, decided — and the worst case is 768, not 390.** `@media (max-width: 47.5rem)` currently carries `.a-appwin__sidebar { display: none }` — the entire mobile strategy, and directly against spec §8.2's demand for a legible rail at 390px.

> **Measured at HEAD, built `dist/`, headless chromium.** The breakpoint is `47.5rem` = **760px**, so **a 768 viewport sits ABOVE it and receives none of the narrow rules.** At 768 the hero `.a-appwin` is **639.6px**, the sidebar is **159.4px** and still `display: flex`, and `.a-appwin__line` computes to **7.33px** — `max(1.15cqw, 7px)`, i.e. pure `cqw` with the floor barely engaged. At 390 the narrow query pins the same rung to a flat **8px**. **The smallest chrome type on this page is therefore at 768, in a 159px rail, with no floor of its own** — which is why the type bullet above gives the rail's own rungs `max(Ncqw, 9px)` rather than leaving them on the transcript's 7px.
>
> **The 390 arithmetic works, and here it is so gate 2 has a pass/fail line.** The `.a-appwin` container is **298.4px** at a 390 viewport, so `42cqw` = **125.3px** of rail and **~172px** for the single pane — *wider* than today's 149px pane columns. A sentence at the 8px floor gets roughly **24 characters** before it ellipses. Tight, but the strategy is sound and the numbers are real.

> **At ≤47.5rem the rail STAYS and the pane grid drops to one pane.** `.a-appwin__sidebar { display: flex }` overrides the hide; the rail takes `42cqw`; `.a-appwin__grid` becomes one column showing the focused `claude` pane and the other two panes go `display: none`; the rail's sentence bottoms out at the 8px floor the transcript already uses; sentences truncate with `text-overflow: ellipsis`, exactly as `.asr-row__msg` does in the app.
>
> **Why not the alternatives.** Keeping `display: none` proves nothing about the rail, which is the whole subject of the redesign. A glyph-only collapsed rail is a **product state that does not exist** — the app's narrow behaviour is `sidebarCollapsed`, which takes the rail to width 0 (`settings-schema.ts:190`), and inventing a middle state is inventing a product. So the honest compression is **fewer panes, not less rail**, and a truncated sentence is the app's own behaviour rather than a mock defect.
>
> Also restore the seam: the companion rule `.a-appwin__sidebar + * { border-left: none }` at `:1362` must go too, or the stage loses its structural line at exactly the width where the rail is hardest to read.
>
> 390px is a **marketing-page** check width. The app's own minimum is 480px; this plan makes no claim about the app at 390.

**Acceptance:** at 1440 the hero rail shows three clusters with zero visible carets and zero visible `+` **at rest**, and hovering a cluster reveals its `+` and caret; **at 768 no rail text computes below 9px** (read `getComputedStyle` on `.a-appwin__clustername`, `.a-appwin__rowmsg` and `.a-appwin__rowage` — this is the worst case, and the one an earlier draft did not check); at 390 the rail is visible, the stage shows one pane, and the page has no horizontal scrollbar; with reduced motion forced, no `.a-appwin__wsdot` animates and `.a-appwin__mark[data-state="working"]` is dimmed. `npm run build:landing` is the phase gate (§4.1).

---

**T18 — monogram styles and the agent strip** · lane I · depends on: T10

**Files:** `marketing/landing-prototype/styles/direction-a.css`

- `.agent-strip__mark--mono` — the Cursor monogram: a `--sg-chrome-2` disc, `--sg-fg-dim` ink, 9px/600, grid-centred, matching the `<img>`'s 20px box so the strip's rhythm does not shift. **No brand tint** (T3).
- **This task styles the 20px strip mark and NOTHING else.** The scene-side monograms — `scene-restore__mark`, `scene-rail__mark`, `scene-picker__mark`, `scene-surfaces__tabmark` at 18px and T16's catalog rows at 15px — are styled in `scenes.css`, which is **T19's** file (§4). Writing them here would put scene rules in the page sheet and split one visual treatment across two owners. T19 matches this rule's treatment; T18 does not reach across.
- Nearest existing idioms for reference: `.a-appwin__wslogo--mono` (`:639-647`) and `.tour__agentchip` with `--chip-tint` (`tour.css:411-423`). Both are tinted; this one deliberately is not.

**Acceptance:** the strip's sixth chip aligns on the same baseline and box as the other five; no `--ws-tint` or `--chip-tint` is read by the new rules.

---

### Phase 5 — Scene styles and panel scaffolding
*Lanes A/B concurrent. Two disjoint stylesheets. Sequenced after Phase 4 so both style markup that exists.*

---

**T19 — scene styles** · lane A · depends on: T11–T16

**Files:** `marketing/landing-prototype/styles/scenes.css`

- Rework the four existing blocks — `restore` (`:40-149`), `rail` (`:151-308`), `picker` (`:310-439`), `surfaces` (`:441-571`) — onto the new tokens and the new chrome. `.scene-surfaces__editor` is **declared twice today** (`:519` and `:533`); collapse it.
- Add two new blocks for `usage` and `catalog`.
- Add the surfaces link beat's two rules (T14).
- **Every `.scene-*__mark--mono` rule lives here, not in `direction-a.css`** (§4): `scene-restore__mark` (`panel-scenes.js:99`), `scene-rail__mark` (`:191`), `scene-picker__mark` (`:259`) and `scene-surfaces__tabmark` (`:336`) at **18px**, and T16's catalog rows at **15px**. Match T18's `.agent-strip__mark--mono` treatment exactly — `--sg-chrome-2` disc, `--sg-fg-dim` ink, no tint — and scale only the box.
- **Add every new scene's reveal animation to the reduced-motion list at `:574-577`, and fix the one already missing.** `.panel.is-revealed .scene-rail__archived` (`:269`) is a **fifth** revealed animation that the reduce block never named — a pre-existing spec §8.4 violation, not something this rework introduces. It goes in with the new ones. Any reveal missing from that block animates under `prefers-reduced-motion: reduce` with no error anywhere.
- **This sheet reads `--sg-hairline-soft` at `:59`, `:256` and `:364`** (MN5's ten consumers). T4 keeps it an alpha; if it ever became the app's solid `--sidebar-seam`, three rules here go with it.
- Panel 5's range selector: the active option is a 4% `--fg` wash — **no pill, no shadow** (`12-usage.css:428-458`).
- **Each new scene needs its own `@media (max-width: 47.5rem)` treatment, because the two new panels are the densest content in the tour.** Measured at HEAD (built `dist/`, headless chromium), a panel's `.a-appwin` is:

  | viewport | `wide` panel | `side` panel |
  |---|---|---|
  | 1440 | 1047.2 × 649.3 | 546.7 × 338.9 |
  | 768 | 602.1 × 373.3 | 602.1 × 373.3 |
  | 390 | 254.8 × 158 | 254.8 × 158 |

  Panels 5 and 6 are both `side`, so at 390 each has **254.8 × 158 px**. Into that, T16 puts two group heads with count pills plus six rows of mark + name + a 47-character command (`codex --dangerously-bypass-approvals-and-sandbox`) + an Enabled/Disabled radiogroup; T15 puts a nav rail + the big figure + a footnote + four range options + the estimate note + two agent rows with share bars; and T12 grows from five rows to six agents + a shell row + a key line = eight rows. **Decided drops at ≤47.5rem: catalog hides `.lp-command__flags` and the radiogroup, keeping mark + name + binary; usage hides the per-agent share sub-line.** Nothing else is invented — a panel that cannot fit its content drops content, it does not shrink type below the 9px floor.

**Acceptance:** every `.panel.is-revealed` animation defined in the file appears in the reduced-motion block, `.scene-rail__archived` included; `grep -c "scene-surfaces__editor {" marketing/landing-prototype/styles/scenes.css` → **1**; at 390 no scene text wraps or clips and the longest catalog command stays on one line (gate 2). `npm run build:landing` is the phase gate (§4.1).

---

**T20 — panel scaffolding and plates** · lane B · depends on: T8

**Files:** `marketing/landing-prototype/styles/tour.css`

- Plate rules: delete `[data-scene="grid"]` (`:261`); add `[data-scene="usage"]` → `--plate-plateau` and `[data-scene="catalog"]` → `--plate-cloudstudy` at `background-position: 68% 22%`. Keep rail/restore/picker/surfaces.
- **Amend the comment at `:258-260`** — it claims *"these five never repeat it or each other"*, which panel 6 breaks. Record the reuse and why (six panels, five available plates, no new asset).
- Delete the stranded board CSS: `.tour__board*` (`:307`), `.tour__recents` / `.tour__recent` (`:332-355`), `.tour__thumb*` (`:356-385`), `.tour__agentchip` (`:411`), `.tour__openkbd` (`:425`), `.tour__scenegrid .a-appwin__pane` (`:440`).
- Delete `.tour .a-appwin__wsavatar[data-ws-status=…]` (`:446-472`) — the tour no longer calls `renderStageSidebar`, so these are dead. **The video keeps its own copy at `video.css:350-397`; do not touch that file.**
- Keep `.panel__art .a-appwin` (`:291`) and the `.tour` scope's `--a-*` aliases (`:12-29`) — the shared chrome resolves through them outside `.direction-a`. **Any new `.a-appwin__*` rule that reads an `--a-*` var must have an alias in all three scopes** (`.direction-a`, `.tour`, `.vid-frame`); prefer `--sg-*`, which needs none.

**Acceptance:** six `[data-scene=…] .panel__stage-art` rules matching §3.6; `grep -n "tour__board\|tour__recent\|tour__thumb\|tour__openkbd\|tour__scenegrid\|wsavatar" marketing/landing-prototype/styles/tour.css` → no hits.

---

### Phase 6 — Verification and records
*One lane. Everything else has landed.*

---

**T21 — gates, the one new test, and the record** · depends on: everything

**Files:** new `marketing/landing-prototype/src/stage-markup.test.js`, new `scripts/capture-landing-stage.mjs` (gate 2), the per-task `*.test.js` files this task absorbs and deletes (§4.1), `docs/CONTEXT.md`, `AGENTS.md`, this plan

Full detail in §6. In short: run gates 1, 2 and 4; write the contract test; assemble screenshots; hand gates 3 and 5 to the owner; record what is verified and what is owed, including the video's colour drift (§2.4).

---

### Summary — the phase layout

| Phase | Lanes | Tasks *(lane · depends on)* |
|---|---|---|
| **1** — Data, renderers, marks, tokens | 4 | T1 (A · —), T2 (B · —), T3 (C · —), T4 (D · —) |
| **2** — Seams, copy and the sheet split | 3 | T5 (A · T1, T2), T9 (B · —), T10 (C · T4) |
| **3** — Scene modules and the hero | 2 | T6 (A · T2, T5), T7 (B · T2, T5) |
| **4** — Registry, scene bodies and chrome styles | 9 | T8 (A · T6, T9), T11 (B · T3, T6), T12 (C · T3, T6), T13 (D · T6), T14 (E · T3, T6), T15 (F · T3, T6), T16 (G · T3, T6), T17 (H · T4, T10), T18 (I · T10) |
| **5** — Scene styles and panel scaffolding | 2 | T19 (A · T11–T16), T20 (B · T8) |
| **6** — Verification and records | 1 | T21 (· everything) |

**21 tasks, 6 phases, 9 lanes at the widest. Every arrow in that table points at a task in an EARLIER phase — there is no dependency inside a phase**, which is what "concurrent" has to mean for it to be safe to hand a phase's lanes to different agents at once. `npm run build:landing` runs at each phase's end, not per task (§4.1).

Three placements were corrected by the review pass and are worth naming, because they are the ones a reader of the earlier draft would remember differently: **T6 gained a dependency on T5** (it imports through the shim T5 widens) and moved from Phase 2 to Phase 3; **T9 and T10 moved up** into Phase 2, where nothing depends on them; **T8 moved down** into Phase 4, because it consumes T6's `SCENES` and T9's two new copy keys.

---

## 6. Verification plan

Spec §8 lists five gates. **Two honest facts frame all of them.**

> **There is no test at all covering the stage.** `release-data.test.js`, `changelog-view.test.js` and `download-links.test.js` are the only landing tests, and `grep -l "stage\|appwin"` across them returns nothing. Nothing covers `stage-data.js`, `appwin.js`, `product-stage.js`, `panel-scenes.js`, `directions/a.js` or `copy.js`. **`npm run build:landing` passes even if the markup is wrong** — it is a bundling check, not a correctness one.
>
> **There is no Playwright test harness.** `playwright-core@^1.62.0` is a devDependency; there is **no `@playwright/test`, no `playwright.config.*`, no runner**. It is used programmatically in three places. The reusable piece is `findChromium()` in `marketing/video/render/capture.mjs:19-45`.

### Gate 1 — build and existing tests

```
npm run build:landing
npx vitest run marketing/
npx oxlint marketing/ && npx prettier --check marketing/
```

**The lint command is scoped to `marketing/` on purpose, and this is why.** `npm run lint` is `oxlint && prettier --check .` — the whole repo — and **it exits 1 at HEAD on a clean tree, before this work starts.** oxlint reports *errors*, not warnings, in three app files: `src/lib/link-target.test.ts` (`jest/vitest(valid-expect)`, lines 149-176), `src/ui/agent-rail.test.tsx:36` and `src/ui/app.tsx:14` (`import/no-duplicates`). The environment baseline this plan was written against never measured lint, so an earlier draft told the implementer to "expect clean and green" — which leaves two bad outcomes: report the gate as failed on work that did not cause it, or "fix" errors inside `src/`, which spec §7 forbids outright. **Record the repo-wide red as pre-existing, naming those three files, and gate only on `marketing/`.**

**State plainly in the report that none of the pre-existing landing tests touches the stage** — they prove the changelog and download paths still work, nothing more. **And the video tests do not cover it either:** `marketing/video/src/transcript.test.js:6-19` builds its **own** frozen fixture and imports only `./transcript.js`; `timeline.test.js` imports only `./timeline.js`. Neither mentions `stage-data.js` or `stagePanes` — zero hits. So **T1 has no automated signal at all until T21's test lands**, which is a fact about how carefully T1's diff has to be read, not a footnote.

**Because gate 1 proves so little, this plan adds one test.** `marketing/landing-prototype/src/stage-markup.test.js` — pure string assertions over the renderers, no jsdom needed for most of it, picked up by the existing `marketing/**/*.test.js` include glob. It pins **the seams the rewrite can silently break**, not appearance:

1. Every `[data-tail]` / `[data-dot]` value in the hero markup matches a `[data-stream]` id.
2. Every `SCENES` key has a `PANELS` entry and vice versa.
3. Every `PANELS` key has a `Title` and a `Body` in **both** locales, and `Object.keys(messages.en)` matches `Object.keys(messages.vi)`.
4. No renderer emits `undefined`, `null`, `NaN` or `[object Object]`.
5. `renderStageRail` of a `remembered` cluster emits no caret; of a `framed` tab emits N leaves and zero rows.
6. Under `prefers-reduced-motion`, `renderStaticFrame` leaves each mark at its pane's **last** `state` and each `[data-tail]` at its **last** `tail` (this is gate 4, made automatic).
7. `AGENT_MARKS` has six entries, `cursor-agent` last, and no renderer emits `src="null"`.
8. **With motion ALLOWED**, the frame immediately after mount carries each pane's **first** `state` and **first** `tail` — the animated seed (§3.5). Without this, assertion 6 passes while the animated page runs backwards.

That is roughly 90 lines and it is **the only automated signal that this rewrite is wired**. Owned by T21, which **absorbs the per-task `*.test.js` files §4.1 permits and deletes the ones it replaces** — those exist so that T2, T3, T5 and T11–T16 have somewhere to assert before Phase 6, not as a parallel suite.

### Gate 2 — screenshots at 1440, 768, 390 — **obtainable here**

`findChromium()` **resolves in this environment**: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, and `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell` exists. Confirm before starting:

```
ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-*/chrome-linux/headless_shell
```

Then add `scripts/capture-landing-stage.mjs`, modelled on `marketing/video/render/capture.mjs` (import `findChromium`, do not re-implement it). This is idiomatic — the repo already carries two ad-hoc capture scripts (`scripts/capture-updater-preview.mjs`, `scripts/verify-electron-gate-m-package.mjs`). It should: serve the built `dist/`, visit the landing, and shoot the hero plus each of the six panels at 1440 / 768 / 390, **twice** — once normally and once with `prefers-reduced-motion: reduce` emulated, which produces gate 4's evidence in the same run.

Checks on the output, each with a pass/fail line rather than an impression:

- **768 is the worst legibility case, not 390.** The breakpoint is `47.5rem` = 760px, so 768 sits *above* it and gets none of the narrow rules: measured at HEAD the hero `.a-appwin` is 639.6px there, the sidebar 159.4px and still `display: flex`, and `.a-appwin__line` computes to **7.33px**. At 390 the narrow query pins the same rung to a flat 8px. **Assert that no rail text computes below 9px at 768** — `.a-appwin__clustername`, `.a-appwin__rowmsg`, `.a-appwin__rowage` (T17's floors).
- **390 has a stated arithmetic to check against.** The `.a-appwin` container is 298.4px at a 390 viewport → `42cqw` = 125.3px of rail and ~172px for the single pane, and ~24 characters of sentence at the 8px floor. If the rail measures materially under 125px or the pane under 170px, the strategy did not land.
- **At 390 no scene text wraps or clips, and the longest catalog command stays on one line.** A `side` panel is 254.8 × 158 px there (T19's table), and panels 5 and 6 are the densest content in the tour — this is the check that T19's narrow drops actually happened.
- **No horizontal overflow at any width** — assert `document.documentElement.scrollWidth <= innerWidth` in-page, cheaper and stricter than reading a picture.

`scripts/capture-landing-stage.mjs` is a **new file owned by T21** and listed in §4.

**If the binary is absent** on the machine that runs this, the gate is **owed**, and the fallback is `npm run prototype:landing` plus the owner's own browser at three widths — which is the evidence class this repo actually accepts (gallery screenshots).

### Gate 3 — `frontend-design-bar` on assembled screenshots

**Not a repo command.** `grep -rn "frontend-design-bar"` finds it only in plan and spec prose — it is a review agent in the owner's workflow. The implementer's job is to **assemble** the gate-2 images into a review set (spec §8.3: "assembled, not generated") and hand them over. **The implementer cannot pass this gate and must not claim it.**

### Gate 4 — reduced motion renders every completed frame

Three layers, all obtainable:
1. **Automatic** — assertion 6 of the new test.
2. **Static** — every `.panel.is-revealed` animation appears in `scenes.css`'s reduce block, and `.a-appwin__wsdot` / `.a-appwin__mark--spinner` appear in `appwin.css`'s.
3. **Visual** — the reduced-motion half of the gate-2 run.

### Gate 5 — owner eye review of the running page

**Always owed. An agent cannot produce it.** `npm run prototype:landing` and hand over. The repo's own standard, stated in the spec: *build passing ≠ finished*.

### What must be recorded as owed

| Claim | Status after this work |
|---|---|
| The landing stage mirrors the shipped app | `building` / **unverified** — build, the new contract test and screenshots only |
| The marketing video still builds | **verified** by the video entry linking and painting — nothing in `marketing/video/out/` is re-rendered |
| The rendered video assets match the app | **false and knowingly so** — stale in shape (spec §6) **and now in colour** (§2.4) |
| `frontend-design-bar` pass | **owed** — owner-side |
| Owner eye review | **owed** |

---

## 7. Risk register

| # | What breaks silently | Cheapest check that catches it |
|---|---|---|
| R1 | **`.a-appwin__sidebar` renamed** → the stage's only structural seam vanishes in hero + tour + video, and the mobile rule stops matching. No error anywhere. | `grep -c "a-appwin__sidebar" marketing/landing-prototype/styles/appwin.css` ≥ 3, and one screenshot showing the vertical line. Prevented by design: §3.3 rule 1 keeps the class. |
| R2 | **`appwin.css` registered only in the landing entry** → the whole video stage renders unstyled. Builds fine. | `grep -n "appwin.css" marketing/video/src/main.js` → 1 hit. |
| R3 | **A name dropped from `product-stage.js:18` or the shim's export list** → immediate ESM link error, and for `product-stage.js` it is the **landing** that fails, not just the video. | `npm run build:landing`. It is loud — the one failure mode in this plan that is. |
| R4 | **`renderStaticFrame` not widened** → reduced-motion users see a rail with the pane's *first* sentence and an out-of-date dot forever. Nothing errors. | New-test assertion 6. |
| R4b | **`renderStaticFrame` widened and the animated path NOT seeded** → the opposite defect, and louder: with motion on, the rail paints every pane's *final* sentence and dot for one frame, then jumps backwards to step 1 — and repeats it on every loop, because the rest gap resets `index = 0` without clearing (`product-stage.js:92-105`). | T5's animated-path assertion: the frame immediately after mount carries the pane's FIRST `state`/`tail` (§3.5). |
| R5 | **A reveal animation missing from `scenes.css`'s reduce block (`:574-577`)** → it animates under `prefers-reduced-motion: reduce`. Fails spec §8.4 silently. **One is already missing at HEAD** — `.panel.is-revealed .scene-rail__archived` (`:269`) — so this is a live defect, not only a future one. | Every `.panel.is-revealed` selector in the file also appears in the reduce block. Greppable, and the count must go up by the two new scenes **plus one**. |
| R6 | **The cluster header's two trailing 17px tracks collapsed** when their ink is invisible, **or the header emitted as four direct children of a three-track grid** → either way the header's name column stops in a different place from the rows'. The second is worse: a fourth child auto-places onto an implicit **second row**, dropping the caret below the name. Both reproduce the class of defect the owner caught on 2026-08-19. | §3.3 rule 4 is the markup contract; T2's acceptance asserts the header has exactly one `clustertoggle` + one `clusteradd` and no other direct child. Plus one screenshot with a straight edge on the name column. |
| R7 | **`data-tail` looked up with `querySelector`** instead of `querySelectorAll` → the rail updates and the strip chip does not, or vice versa. Half-alive. | New-test assertion 1, plus watching both change in one loop. |
| R8 | **The hook lookup widened to `document`** → collides across mounts the moment a second panel gets a grid. Invisible today because there is exactly one mount. | `grep -n "document.querySelector" marketing/landing-prototype/src/product-stage.js` → only the pre-existing engine internals. |
| R9 | **A markless agent reaching a bare `<img>`** — three renderers do this, not one, and T3 only fixes the first. | `grep -rn 'src="\${agent.mark}"' marketing/landing-prototype/src/` → no hits **after T12**, not after T3. Between Phase 1 and Phase 4 the picker scene renders `src="null"` for Cursor; the transient is named in T3 and closed in T12. |
| R10 | **`tourKicker` left as "// from folder to full formation"** → the section label advertises the panel that was cut. | `grep -n "full formation" marketing/landing-prototype/src/copy.js` → no hits. |
| R11 | **VI copy drifting from EN** — a missing key renders `undefined` in one locale only, and nobody browses in the other. | New-test assertion 3. |
| R12 | **Percentage size + padding without `box-sizing`** — the AGENTS.md trap. The landing has a global reset (`base.css:14-16`) but it is linked from `index.html:15`, **not imported by `main.js`** — so any jsdom test or standalone harness renders with **no reset**. | Declare `box-sizing: border-box` explicitly on every new element given a percentage size and a padding. Do not rely on the page reset. |
| R13 | **A 1px overflow inside a scroll container moves the whole shell** — the second AGENTS.md trap, and the exact bug the DL-27.19 frame hit twice. | Prevented by using the **inset box-shadow**, never a border or an outline, on `.is-framed`. Assert `scrollWidth <= innerWidth` in the gate-2 run. |
| R14 | **`--sg-hairline-soft` set to the app's solid `--sidebar-seam`** → pane borders nearly vanish on the landing **and** three `video.css` rules change. | §2.1 keeps it an alpha. `grep -rn "sg-hairline-soft" marketing/` shows **all ten** consumers before editing — `direction-a.css:602, 713, 826`, `scenes.css:59, 256, 364`, `tour.css:345`, `video.css:196, 205, 319` — across four sheets, two of them owned by T19 and T20. |
| R15 | **A new `.a-appwin__*` rule reading an `--a-*` var** → undefined in the `.tour` or `.vid-frame` scope; only `--a-font-display` / `--a-font-mono` are aliased in all three. | Prefer `--sg-*` exclusively in `appwin.css`. Grep the new sheet for `var(--a-` → only the two font vars. |
| R16 | **Two agents editing one file.** | §4 is the contract. Lanes share **one** working tree (§4.1), so a dirty tree is normal and "confirm no other lane's files are dirty" is not runnable. The check is: before starting, `git status --short` and confirm **no file on YOUR Files line** is already dirty. |
| R17 | **T17 restyling a class the video's titlebar emits** — `.a-appwin__iconbtn`, `.a-appwin__lights`, `.a-appwin__titlebar`, `.a-appwin__actions`, `.a-appwin__actionsep`. Their rules move into `appwin.css` under T10, and T10 registers that sheet in the **video** entry, so a restyle reaches the rendered video silently. This is the AGENTS.md "component changes can silently alter rendered media" trap arriving through CSS rather than markup. | New controls use `.a-appwin__ctl` (§3.3 rule 6). After T17, `git diff` of `appwin.css` must show those five classes' declarations **unchanged** from what T10 moved. |
| R18 | **A task chasing a repo-wide grep into another lane's file.** T6's acceptance used to grep the whole tour directory for names that only die in T8, so an agent driving it to zero would have edited `tour/index.js` — T8's file. | Every acceptance grep is scoped to the paths on that task's own **Files** line. Where an assertion genuinely spans two tasks it is split, and each half is stated where it can pass (T6 → T8). |

---

## 8. Out of scope

Restating spec §7, plus what this plan defers on purpose.

**From spec §7:**
- Rendering or updating any marketing video output. `marketing/video/out/` is untouched.
- Changelog page, download links, release data, topbar, hero copy, plates *(one exception: the plate **assignment** rules in `tour.css` move with the panel list — no plate asset is added, encoded or replaced)*.
- The app itself — **no `src/` or `electron/` change of any kind**.
- New brand assets. Cursor stays a monogram until the app itself ships one.

**Deferred by this plan, explicitly:**
- **Rewriting `marketing/video/src/stage-driver.js` onto the new chrome.** The video keeps drawing the old shell via `renderStageSidebar` + `renderStageStatus`, which is why nothing is removed from `marketing/stage/`. Its `collectRefs` hard-requires a `[data-ws-avatar="${BRAND.slug}"]` node (`:121`) and `apply()` writes to it every frame (`:234`); its `sidebarStatus` derivation (`:95-100`) is shaped for a flat `{id, active}` list that `stageRail` does not have. Migrating it is a separate task with its own render gate.
- **A `stageStatus` / `renderStageStatus` deletion.** Both survive as video-only. Deleting the data and keeping the renderer breaks `appwin.js:126`, which reads `stageStatus.hints` at call time; deleting the renderer breaks eight call sites.
- **`stage-data.js`'s `stageSidebar`.** Kept, video-only, commented. **This one is a spec deviation, not only a deferral** — spec §5 row 1 asks for its replacement — and it is recorded as **D12** in §1 so the AGENTS.md / CONTEXT entry T21 writes is honest that the video keeps drawing the July shell by choice.
- **A seventh `--plate-*` asset.** Panel 6 reuses `cloudstudy` at a new crop (§3.6).
- **A Playwright *test runner*.** Gate 2 is a one-off capture script reusing `findChromium()`, not `@playwright/test` + a config + a CI job. Standing up a runner is its own decision.
- **A Cursor brand tint.** Neutral monogram until the app ships a mark and a colour.
- **Splitting `scenes.css`.** One owner, sequenced (§4). The cost is named there: the file lands near **830 lines**, past spec §5's size guidance, which `max-lines` only warns about. It is not a six-way split argument — one extra sheet would be one import in a file T10 already owns.
- **Any `docs/DESIGN-LANGUAGE.md` amendment.** DL binds app chrome. This work is a drawing of chrome that already obeys it.

---

## Revision log

**2026-08-20 — review pass applied.** This plan was audited against HEAD `523130f` on a clean tree, with measurements taken through headless chromium. Five BLOCKERs, thirteen MAJORs and twenty-two MINORs were raised and **all of them are applied here.** What the reviewer verified as already correct — the whole colour re-derivation of §2, the four CSS extraction ranges, the video-coupling claims, every `tour/index.js` cite, the plate scarcity decision, every verbatim source string, all ten source-vs-spec deviations, and §3.2's decoupling argument — is unchanged.

**BLOCKERs**

- **B1 — Phase 2 was not concurrent.** T6 reaches `renderStageRail` through the shim T5 widens, so it could not build beside T5. T6 now declares `depends on: T2, T5` and sits in Phase 3; the whole phase layout was reworked around it and is stated in §5's Summary.
- **B2 — T6's acceptance could not pass.** Its `renderStageSidebar` / `renderStageStatus` grep spanned `tour/index.js`, which is T8's file and where those calls actually die. The grep is scoped to T6's own files; the other half moved into T8's acceptance. New risk R18.
- **B3 — bare `src/…` paths resolved to the app tree.** Every landing path in §5, §6, §7 and the risk register is now `marketing/landing-prototype/…`. Six `src/` references remain and all six are deliberate citations of the app.
- **B4 — §3.3's cluster header could not produce T17's grid.** Four children in three tracks auto-place onto a second row. `.a-appwin__clustertoggle` (spanning `1 / -1`), the pinned `.a-appwin__clusteradd`, the caret's `margin-left: 24px`, `.a-appwin__clusterstill` and `.a-appwin__clusterremove` are all fixed in §3.3 rule 4 and mirrored in T2 and T17.
- **B5 — the bare row's children were never named.** `__rowmark` / `__rowmsg` / `__rowage` / `__rowlogo` are fixed alongside the leaf set in §3.3 rule 5, with the shared `a-appwin__mark` painting hook and the close's overlap of cell 4 spelled out.

**MAJORs**

- **M1** — `npm run lint` is red at HEAD for three pre-existing `src/` files; gate 1 is scoped to `marketing/` and records the red.
- **M2** — the video tests do not read `stagePanes`; the claim is struck and T1's lack of any automated signal is stated.
- **M3** — the spinner's `--dot` runs `0…7`, not `1…8`, or the ring pops in.
- **M4** — T12's key line carries **three** `·`, not four.
- **M5** — T18 owns `.agent-strip__mark--mono` only; every `.scene-*__mark--mono` is T19's; sizes are 20 / 18 / 15.
- **M6** — the measured panel-size table is in T19, with decided narrow drops for the catalog and usage scenes and a matching gate-2 check.
- **M7** — **768 is the worst legibility case**, not 390; T17 gives the rail's rungs `max(Ncqw, 9px)` floors and the 390 arithmetic is stated as measured numbers.
- **M8** — widening `renderStaticFrame` makes the animated path start at the end; §3.5 now decides the first-step seed and T5 asserts it. New risk R4b.
- **M9** — keeping `stageSidebar` is a spec deviation and is now **D12** in §1's table.
- **M10 + MN19** — §4.1 decides it outright: one shared working tree, `build:landing` as a **phase** gate, and each task writing its own `*.test.js` beside its file for T21 to absorb.
- **M11 + MN22** — new controls are `.a-appwin__ctl`; the five classes the video's titlebar emits are read-only for T17. New risk R17.
- **M12** — T8's deletions were incomplete: `disposeStreams`' consumer at `:470-472`, all of line 24, and three names on the `../appwin.js` import; `BRAND_ICON_SRC` stays.
- **M13** — "a mock has no pointer" was false for the landing. §1.1's premise is rewritten, the resting-frame decision stands, T17 ports the app's real `:hover` / `:focus-visible` reveals, and D6 stays flagged for gate 5.

**MINORs** — all twenty-two applied: corrected line cites (MN1–MN5, MN12, MN13, MN21), contract clean-ups (MN6, MN11, MN20), runnable acceptance commands (MN8, MN9), ownership and file-list gaps (MN10), the pre-existing reduce-block omission (MN7), honest rationales (MN15, MN16), and the interlocks and transients now stated rather than discovered (MN14, MN17, MN18).
