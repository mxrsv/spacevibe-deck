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
| **D3** | §3 panel 3: `claude --dangerously-skip-permissions --resume <id>` | `agent-resume.ts:41`: the claude id form is **`claude --resume ${id}`** — no permissions flag. `codex resume ${id}` (`:42`) and `opencode -s ${id}` (`:43`) are correct | Panel 3 prints `claude --resume 0f3a91c2`, `codex resume 019a4f1c`, `opencode -s 3b77ae`. Note the *existing* `panel-scenes.js:50-81` already had claude right — the spec introduced this error. The one real change is codex: today's `codex resume --last` is the *latest* form; the id form is what a restore of a known session types. | T13 |
| **D4** | §3 panel 6: "a starred default row" | `launch-profile-editor.tsx:42-46`: both "Set default" and the ↗ website link were **removed on the owner's ask 2026-08-19**. `BuiltinAgent.url` and `Settings.defaultAgent` are kept as data only. No `Star` icon exists anywhere in `src/ui/settings/`. The enable control is a two-button `role="radiogroup"` labelled verbatim **"Enabled" / "Disabled"** (`:97-128`) | **The mock must not draw a starred row.** Panel 6 draws the Enabled/Disabled segmented radiogroup and nothing else per row. | T16 |
| **D5** | §3 panel 5: "the dock's Usage tab (⌘⇧Y neighbourhood)" | `default-keymaps.ts:211` `toggle-usage` = **⌘⇧U**; `:218` `toggle-sessions` = ⌘⇧Y; `:206` `toggle-explorer` = ⌘⇧B | Panel 5's copy says **⌘⇧U**. §4's finale addition (⌘⇧B explorer, ⌘⇧Y sessions) is **correct** and ships as written. | T9, T15 |
| **D6** | §2's ASCII hero draws the cluster caret and `+` as always-on | `04a:265, 271-274, 355-366`: `.asr-cluster__caret { opacity: 0 }` and `.asr-cluster__add { opacity: 0 }` — both paint only on `:hover` / `:focus-visible`. A **collapsed** cluster keeps its caret. The remembered header's `×` is hover-only too. `.asr-cluster__still` (`:228`) has **no caret at all, ever** | **Decided — see §1.1.** | T1, T2, T11, T17 |
| **D7** | §2 draws a "framed tab" implying a parent row above the leaves | `agent-rail.tsx:201, 216-217`: `PANE_TREE_HIDDEN = true`, so **every multi-agent tab is headless** — no parent row renders; the panes render as `.asr-leaf.asr-leaf--flat` buttons. The framed item paints **no selection wash and no accent bar** (`04b:80-84`) | **Decided — see §1.1.** | T2, T11, T17 |
| **D8** | §3 panel 5: "range selector + a metric table" | `overview-section.tsx:246`: the range selector belongs to **Overview only**, and Overview has **no table at all**. Only Daily and Breakdown use `MetricTable`. The composite does not exist on any one view | **Decided — see §1.2. Panel 5 draws Overview.** | T15 |
| **D9** | §3 panel 6: shipped commands including opencode's | `agent-catalog.ts:66`: opencode has **no `defaultCommand` key**, by design. `catalogLaunchCommand` falls back to `builtin.id` (`:230-239`) | opencode's row prints the bare word `opencode` with an **empty** `.lp-command__flags` span. The span still renders — the row's grid must not collapse. | T16 |
| **D10** | §2: "~896×556 CSS px at 1440 viewport"; the `stage-data.js` transcript scripts | Not confirmable from `src/` — both are marketing-side facts | Treated as **unverified marketing assertions**, not app claims. The mock keeps `aspect-ratio: 1000/620` (`direction-a.css:489`) and its `cqw` scaling; no task asserts a pixel measurement. The three transcript scripts are kept as shipped (spec §2). | — |
| **D11** | *(beyond the note's ten)* §2 motion contract: "The active chip echoes the **focused** pane's tail" | `tab-strip.tsx:147-148` → `tabTail(tab, tails)` → `loudestPane(paneRows(...))?.message` (`agent-rail-model.ts:300-307`, `:314`). The chip prints the **loudest** pane's sentence by `STATE_RANK` (failed 4 > asked 3 > working 2 > done 1 > idle 0), tie-broken by newest `changedAt` then pane order | **The mock binds the chip to the focused pane** (`data-tail="claude"`). Reproducing `STATE_RANK` needs a cross-pane scheduler the stream engine does not have — each pane runs an independent timer (`product-stage.js:68-117`). The two agree whenever the focused pane is loudest. Recorded as a knowing simplification; nothing on screen claims otherwise. | T5, T7 |

### 1.1 D6/D7 decided — what the STILL hero frame shows

A mock has no pointer, so the only state it can honestly claim is **rest**.

**Decision: the hero rail draws zero carets and zero `+` glyphs, and the multi-agent tab draws no parent row.**

- Every cluster header in the hero is **folder glyph → project name, and nothing else.** That is not an omission; it is `04a:265` and `04a:355-366` rendered faithfully.
- **The two trailing 17px tracks stay, empty.** `.asr-cluster__head` is `grid-template-columns: minmax(0,1fr) 17px 17px; gap: 7px` (`04a:166-187`) and `04a:373` reserves the caret's gutter with `margin-left: 24px` (7 gap + 17 slot). Those tracks are why the header's name column stops exactly where the rows' name column stops — the alignment the 2026-08-19 re-amend bought after the header stood 11px wider than every row under it (AGENTS.md fork queue). **Collapsing the empty tracks is the single easiest way to get this wrong.**
- None of the hero's three clusters is collapsed, so no caret appears anywhere. `spacevibe-hub` is the remembered, rowless one and uses `.asr-cluster__still`, which has no caret by construction.
- The `spacevibe-deck` cluster's multi-agent tab renders **exactly three `.asr-leaf--flat` buttons inside the inset frame** — mark, sentence, age, brand glyph — and the framed item paints no selection wash and no accent bar. The frame itself is `box-shadow: inset 0 0 0 1px var(--hair-strong)` at `--radius-control` with `margin: 3px 0; padding: 3px 0` (`04b:113-118`) — an inset hairline, **deliberately not a border and not an outline** (`04b:86-112`: a border bled the block 1px past its container; an outline paints outside and gets clipped).
- **Where the `+` gets said instead:** (a) the frame row's `New` control and the strip's `+` are always-on in the app and sit above the fold regardless; (b) **panel 1 (`panelRail`) draws one baked hover state.** A zoomed rail panel is a purpose-built drawing of one interaction, so `is-hover` on the *remembered* header reveals its `+` and its `×` — a frame the app really produces — while every other header stays at rest. Panel 1 also draws one **collapsed** cluster, the one legitimate resting state in which a caret is visible.

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

Spec §2 says colours re-derive from `deck-dark`'s relationships. `styles/tokens.css:64-78` holds the mock's entire colour vocabulary — nine `--sg-*` tokens. All nine change value; eleven are added. **Every token NAME is kept**, because `video.css` and the existing rules read them.

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
| `--sg-hairline-soft` | `color-mix(#cbd1ea 8%)` | **`rgba(255, 255, 255, 0.08)`** | *hue-only change.* **Do not** make this the app's solid `--sidebar-seam`: it is read by `video.css:196, 205, 319` and by `.a-appwin__pane`'s border (`direction-a.css:713`), where a near-`--bg` solid would erase the pane edges |

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
  glyph?: string,         // file only, e.g. "ts"
  label: string,
  active: boolean,
}>
```

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
  <span class="a-appwin__iconbtn a-appwin__sidebartoggle">…SidebarSimple, filled…</span>
  <span class="a-appwin__new"><i class="a-appwin__newglyph"></i>New</span>
  <span class="a-appwin__framespacer"></span>
</div>

<!-- renderStageRail(rail) -->
<aside class="a-appwin__sidebar a-appwin__rail">
  …renderStageFrameRow()…
  <div class="a-appwin__raillist">
    <section class="a-appwin__cluster[ is-collapsed]">
      <div class="a-appwin__clusterhead[ is-hover][ is-still]">
        <span class="a-appwin__clusterfolder">…</span>
        <span class="a-appwin__clustername">spacevibe-deck</span>
        <span class="a-appwin__clusteradd">…</span>    <!-- track 2, empty ink at rest -->
        <span class="a-appwin__clustercaret">…</span>  <!-- track 3, empty ink at rest; ABSENT on is-still -->
      </div>
      <div class="a-appwin__item[ is-framed]">
        <!-- framed: N x .a-appwin__leaf ; bare: 1 x .a-appwin__row -->
        <button class="a-appwin__leaf" data-state="working">
          <span class="a-appwin__mark" data-state="working" data-dot="claude">…spinner svg…</span>
          <span class="a-appwin__leafmsg" data-tail="claude">…</span>
          <span class="a-appwin__leafage">now</span>
          <img class="a-appwin__leaflogo" … />
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
    <div class="a-appwin__chip" data-kind="file">…</div>
    <div class="a-appwin__chip" data-kind="browser">…</div>
    <span class="a-appwin__chipadd">…</span>
  </div>
  <div class="a-appwin__stripactions">
    <span class="a-appwin__iconbtn">…DotsThreeOutline, filled, 15px…</span>
    <span class="a-appwin__iconbtn">…SidebarSimple, filled, mirrored…</span>
  </div>
</div>
```

**Three rules that will otherwise be got wrong:**

1. **`.a-appwin__sidebar` is KEPT as the rail's outer class**, with `a-appwin__rail` added beside it. `.a-appwin__sidebar + *` (`direction-a.css:601`) is an *adjacency* selector carrying the stage's only structural seam, and `.a-appwin__sidebar { display: none }` (`:1358`) is the entire mobile strategy. Both fire off the element's position and class, in the hero, the tour **and the video**, with **no error** if renamed. One extra class token buys all of that; renaming buys nothing.
2. **The spinner SVG is always in the DOM**, inside every `.a-appwin__mark`. CSS shows it only for `[data-state="working"]` and suppresses the `::before` dot in that one state. That is why the stream engine can repaint a pane's whole status by writing **one attribute** and never touching markup.
3. **`data-tail="<paneId>"` and `data-dot="<paneId>"` appear on MORE THAN ONE node per pane** — the rail leaf/row and the active strip chip. Every lookup is `querySelectorAll`, never `querySelector`.

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

**Plate scarcity, decided.** Only six `--plate-*` tokens exist (`tokens.css:51-56`) and the hero owns `--plate-image` (mist). Cutting the `grid` panel frees `plateau`, giving five panel plates for six panels. **Panel 6 reuses `cloudstudy` at a different crop.** This contradicts `tour.css:257-259`'s own comment — *"these five never repeat it or each other"* — so **T20 amends that comment** rather than leaving it asserting something false. Rejected alternative: a seventh plate asset. Encoding a new 30–60 kB painting is scope the spec did not grant, and which painting goes where is an owner choice.

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
| `marketing/landing-prototype/src/tour/scenes/{rail,picker,restore,surfaces,usage,catalog}.js` *(new)* | **T6** creates → **T11–T16** own one each | sequenced across Phase 2 → Phase 4 |
| `marketing/landing-prototype/src/directions/a.js` | **T7** | |
| `marketing/landing-prototype/src/tour/index.js` | **T8** | |
| `marketing/landing-prototype/src/tour/stage-states.js` | **T8** | |
| `marketing/landing-prototype/src/copy.js` | **T9** | |
| `marketing/landing-prototype/src/main.js` | **T10** | |
| `marketing/video/src/main.js` | **T10** | the only file under `marketing/video/` this plan touches |
| `marketing/landing-prototype/styles/appwin.css` *(new)* | **T10** creates → **T17** owns after | sequenced across Phase 3 → Phase 4 |
| `marketing/landing-prototype/styles/direction-a.css` | **T10** (extraction) → **T18** (monograms) | sequenced across Phase 3 → Phase 4 |
| `marketing/landing-prototype/styles/scenes.css` | **T19** | |
| `marketing/landing-prototype/styles/tour.css` | **T20** | |
| `marketing/landing-prototype/src/stage-markup.test.js` *(new)* | **T21** | |
| `AGENTS.md`, `docs/CONTEXT.md`, this plan | **T21** | |

**Untouched on purpose:** `marketing/stage/brand.js`, everything else in `marketing/video/`, `marketing/landing-prototype/styles/{base,frame,changelog}.css`, `vite.build.mjs`, all of `src/` and `electron/`.

**Two merges made to avoid collisions:**
- The Cursor monogram's **CSS** belongs to T18 (`direction-a.css`), not to T3 (`agent-strip.js`). T3 emits class names; T18 styles them. Both are fixed in §5, T3.
- The **six scenes' CSS** all lives in one `scenes.css`, so T19 owns it alone and is sequenced after every scene body. This is the plan's one deliberate serialization; splitting `scenes.css` per scene would need six new `main.js` imports and put T10 back in contention.

---

## 5. Tasks

### Phase 1 — Data, renderers, marks, tokens
*Lanes A/B/C/D run concurrently. Four disjoint files, zero shared imports between them.*

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
- `stageStrip` fixture: active terminal chip `{agent:"claude", paneId:"claude", label:"<claude's opening tail>"}` (D11), inactive file chip `{glyph:"ts", label:"layout-engine.ts"}`, inactive browser chip `{label:"localhost:5173"}`. Order is **open sequence** (`agent-rail-model.ts:384`, `:396` — explicitly not recency).

**Ages** are `"" | now | 2m | 3h | 2d | 5w` — **weeks are the largest unit** (`agent-rail-model.ts:548-568`). Never write months.

**Acceptance:** `node -e 'import("./marketing/stage/stage-data.js").then(m => console.log(Object.keys(m)))'` prints all six exports; every `pane.id` referenced by a `stageRail` pane or a `stageStrip` chip exists in `stagePanes`; every `state` is one of the five; `Object.isFrozen(stageRail)` is true.

---

**T2 — the three new renderers** · lane B · depends on: nothing *(reads shapes from §3.1, not from T1's code)*

**Files:** `marketing/stage/appwin.js`

**Changes:**
- Add `renderStageFrameRow`, `renderStageRail`, `renderStageStrip` per §3.2/§3.3.
- **Keep `renderStageSidebar`, `renderStageStatus`, `renderStageTitlebar`** — the video calls all three (`stage-driver.js:105, 111` and `renderStageTitlebar` via `renderStageSidebar`). Removing `renderStageStatus` alone would break eight call sites.
- `STAGE_ICONS` gains `sidebar` (SidebarSimple, **filled** — it is in `SOLID_ICONS`, `deck-icon.tsx:38`), `plus`, `dots` (**DotsThreeOutline, filled** — never `DotsThree` at fill, `feature-toolbar.tsx:235-249`), `globe`, `file`, `close`, `folder`, `caret`, `refresh`. The existing five stay untouched: the video's `renderStageTitlebar` reads them.
- **Frame row** (`desktop-chrome.tsx:70-112`, `sidebar-toggle.tsx:99-109`): traffic lights → sidebar toggle → `New` (glyph + the word) → drag spacer, **and nothing else**. `app.tsx:1390` confirms `toolbar={sidebar ? null : chromeActions}` — in sidebar mode the frame row carries **no** feature toolbar.
- **Rail:** cluster header emits three grid children always — folder, name, add — plus a caret **unless** `remembered` (`.asr-cluster__still` has no caret, `04a:228`). The `×` renders only for a remembered cluster. `is-hover` is a class the *data* asks for and only scenes set it.
- **Row vs leaf:** a `framed` tab emits `.a-appwin__item.is-framed` wrapping N `.a-appwin__leaf` buttons and **no parent row** (D7). A bare tab emits `.a-appwin__item` wrapping one `.a-appwin__row`. Note the app's own asymmetry, reproduced: the leaf's age is `--text-muted` while the tab row's age is `--text-faint` (`04b:263-271` vs `04a:505-578`).
- **Identity vs sentence differ by tone alone** — both are `450 var(--type-body)/1.25`, primary vs muted (`04a:505-578`). Do not reach for weight or size.
- **Mark:** `renderStageRailMark(state, paneId)` always emits the 8-circle spinner SVG inside the mark span (§3.3 rule 2). Circles carry `class="a-appwin__wsdot" style="--dot:N"` for N = 1…8.
- **Strip:** chips per `kind`; the active terminal chip gets `is-active`, its label carries `data-tail`, and its close glyph renders (visible on `.is-active` as well as hover, `05-tab-bar-toolbar.css:169-172`). Trailing order is `+` → `⋯` → panel toggle (`app.tsx:1462-1509`; `DockToggle` is present by default **because** `dockOpen: false`).
- **A terminal chip shows no colour dot, no attention mark and no rename affordance** (`tab-strip.tsx:130-141`, `:9-13`, `:11-13`). Do not add them back "for life".

**Acceptance:** each renderer returns a string for its fixture and for an empty array; the output contains no literal `undefined` or `[object Object]`; `renderStageRail` of a `remembered` cluster contains `is-still` and **no** `clustercaret`; `renderStageRail` of a `framed` tab contains exactly N `a-appwin__leaf` and zero `a-appwin__row`; no `document.` appears anywhere in the file.

---

**T3 — Cursor joins the marks, behind one shared renderer** · lane C · depends on: nothing

**Files:** `marketing/landing-prototype/src/agent-strip.js`

**Changes:**
- `AGENT_MARKS` gains a sixth entry, **last**: `{ id: "cursor-agent", label: "Cursor", mark: null }`.
  - The id is **`cursor-agent`, not `cursor`** (`agent-catalog.ts:353`). The label is **"Cursor"** — that is the catalog's `label`; an earlier plan wrote "Cursor Agent" and the source disagrees.
  - Last on purpose: order is the digit-key contract (`agent-catalog.ts:84-88`).
  - `mark: null` because `AGENT_LOGOS` (`agent-logos.ts:25-31`) has exactly five keys and `cursor-agent` is absent. **No asset is created** (spec §7).
- Export **one** shared helper and route all three bare-`<img>` renderers through it:
  ```
  renderAgentMark(agent, className, size)  // <img …> when agent.mark, else the monogram span
  ```
  Monogram markup: `<span class="${className} ${className}--mono">C</span>`. The letter is `letterAvatar`'s output — first alphanumeric of the id, uppercased (`letter-avatar.ts:11-18`) → **"C"**.
  **No tint.** The app hashes a `TAB_DOT_COLORS` token from the id; nothing in `marketing/` has that table, and inventing a colour would be a brand claim. Neutral ink on a neutral disc, styled by T18. Recorded as a knowing simplification.
- Three call sites collapse onto the helper: `renderAgentStrip` (size 20), and — after T6 — the scene helper and the picker row map (size 18 / 15). This task changes only the first; the other two consume the new export in Phase 4.

**Acceptance:** `AGENT_MARKS.length === 6` with `cursor-agent` last; `renderAgentStrip(copy)` returns markup containing six chips and exactly one `--mono` span, and contains no `src="null"` and no `src="undefined"`.

---

**T4 — the colour re-derivation** · lane D · depends on: nothing

**Files:** `marketing/landing-prototype/styles/tokens.css`

**Changes:** apply §2.1 and §2.2 verbatim. Replace the block comment at `:64-68` — it currently says *"Tokyo Night app-window chrome … held at 60% of its original saturation"*, which stops being true — with a comment naming `deck-dark`, the pinned `#272d31` literal, the plane inversion (stage is the deepest surface), and **the video consequence in §2.4**.

**Acceptance:** `grep -c '\-\-sg-' styles/tokens.css` → 20; no `color-mix` remains in the `--sg-*` block except where an alpha is intended; `npm run build:landing` clean.

---

### Phase 2 — Seams
*Lanes A/B concurrent. Disjoint files.*

---

**T5 — barrel, shim, and the stream engine's rail hooks** · lane A · depends on: T1, T2

**Files:** `marketing/landing-prototype/src/product-stage.js`, `marketing/landing-prototype/src/appwin.js`

**Changes:**
- **`product-stage.js:11-18`** — import and re-export `stageRail` and `stageStrip` alongside the existing four. **`stageSidebar` and `stageStatus` stay on that line.** This is the second export barrel spec §5 never named; removing a name here is an immediate ESM link error in the **landing** build, not just the video.
- **`src/appwin.js` (the 17-line shim)** — add `renderStageFrameRow`, `renderStageRail`, `renderStageStrip` to the re-export list. Spec §5 never names this file, and every landing `../appwin.js` import misses anything not listed here. Keep `BRAND_ICON_SRC` — `changelog-view.js:1` imports it through this shim.
- **`mountStageStream`** — the `{ chromeRoot }` option, the `querySelectorAll` hook resolution, the tolerated-miss rule, and `applyStep`'s two new fields, all per §3.5.
- **`renderStaticFrame`** — widen to apply `tail`/`state` from every step kind in order, per §3.5. **This is the reduced-motion gate (spec §8.4); it is not optional.**
- The existing throw behaviour for `gridRoot`, `[data-lines]` and `[data-spinner]` is unchanged.

**Acceptance:** re-export line names all six data exports and the shim names all ten renderers; a jsdom mount with a `[data-tail]`/`[data-dot]` node present sets both after the scripted steps; a mount with **no** rail nodes present completes without throwing; under `prefers-reduced-motion: reduce`, the mark's `data-state` equals the pane's **last** `state` and the `[data-tail]` text equals its **last** `tail`.

---

**T6 — split the scenes into modules and rebuild the shared chrome** · lane B · depends on: T2

**Files:** `marketing/landing-prototype/src/tour/panel-scenes.js`, new `marketing/landing-prototype/src/tour/scenes/chrome.js`, new `marketing/landing-prototype/src/tour/scenes/{rail,picker,restore,surfaces,usage,catalog}.js`

**Why split:** `panel-scenes.js` is 391 lines today and the rewrite plus two new scenes puts it near 800. More importantly, **six panels in one file is the plan's largest collision** — the split is what turns Phase 4 into six independent lanes. Spec §5 already contemplates the same move for the CSS.

**Changes:**
- `scenes/chrome.js` exports `frame(body, { rail, strip })` per §3.4, plus `SCENE_RAIL` — one compact shared rail fixture (two clusters, four rows) that scenes not *about* the rail can pass without inventing their own.
- **`frame()` no longer calls `renderStageSidebar` or `renderStageStatus`**, and **`chrome.js` must not import `stage-states.js`.** Both are what let T8 delete `SIDEBAR_STATUS` cleanly.
- `agentMark()` leaves this file; scenes import `renderAgentMark` from `../../agent-strip.js` (T3). Today's `agentMark` has **no null guard** and throws on an unknown id — the helper is what fixes that for all three call sites.
- Move each existing scene body verbatim into its own module (`rail.js`, `picker.js`, `restore.js`, `surfaces.js`), each exporting one zero-argument `() => string`. **Do not change their contents in this task** — Phase 4 does that. A verbatim move keeps this task's diff reviewable.
- Create `usage.js` and `catalog.js` as minimal placeholders returning `frame("")`.
- `panel-scenes.js` shrinks to imports plus `export const SCENES = { rail, picker, restore, surfaces, usage, catalog };`

**Acceptance:** `Object.keys(SCENES)` is exactly those six; every value is a zero-argument function returning a string; `grep -rn "stage-states" src/tour/scenes/` → no hits; `grep -rn "renderStageSidebar\|renderStageStatus" src/tour/` → no hits; `npm run build:landing` clean.

---

### Phase 3 — Composition, registry, copy, sheet split
*Lanes A/B/C/D concurrent. Four disjoint file sets.*

---

**T7 — the hero** · lane A · depends on: T2, T5

**Files:** `marketing/landing-prototype/src/directions/a.js`

**Changes:**
- Imports: `renderStageRail`, `renderStageStrip` from `../appwin.js`; `stageRail`, `stageStrip` from `../product-stage.js`. **Drop `renderStageSidebar` and `renderStageStatus`** from this file's imports — they stay exported, they are just no longer called here.
- Replace the stage composition (`:185-202`) with §3.4. The pane split stays as today — `claude` + `codex` share `.a-appwin__col`, `opencode` is a bare grid child. (The **video's** split differs — claude alone left — and is not this plan's business.)
- `mount()` passes the chrome root: `mountStageStream(section.querySelector(".a-appwin__grid"), { chromeRoot: section.querySelector(".a-appwin") })`.
- Everything else in the file — topbar, pill, headline, CTAs, `renderAgentStrip` mounted *inside* the hero section on purpose (`:204-207`), `updateDirectionALocale` — is untouched (spec §4).

**Acceptance:** the rendered hero contains exactly one `.a-appwin__sidebar`, one `.a-appwin__stage` **immediately after it**, one `.a-appwin__strip`, zero `.a-appwin__status`, zero `.a-appwin__wsitem`; three `[data-stream]` regions; every `[data-tail]` value matches a `[data-stream]` id.

---

**T8 — cut the `grid` panel, rewrite `PANELS`, extend the finale** · lane B · depends on: T6

**Files:** `marketing/landing-prototype/src/tour/index.js`, `marketing/landing-prototype/src/tour/stage-states.js`

**Changes — `tour/index.js`:**
- `PANELS` becomes the six rows of §3.6.
- Delete the special case at `:203` — `panel.scene === "grid" ? renderScene(2) : SCENES[panel.scene]()` becomes `SCENES[panel.scene]()`. **The `grid` panel was never a `SCENES` entry**; it was this ternary.
- Delete the whole stranded chain: `renderScene` (`:280`), `renderBoard` (`:260`), `renderBoardRecent` (`:245`), `renderPresetThumb` (`:239`), `renderAgentChip` (`:233`), and the now-unused imports of `AGENTS`, `PRESET_CELLS`, `SIDEBAR_STATUS`, `boardRecents` (`:26-30`).
- Delete the `.tour__scenegrid` stream mount (`:460-462`) and the `mountStageStream` import (`:24`). After the cut no tour scene emits `[data-stream]` markup; `querySelectorAll` over a class nothing renders is a trap for the next reader, not a seam. `mountStageStream` then has exactly one call site — the hero. Its `chromeRoot` scoping stays anyway (§3.5).
- Finale shortcuts (`:318-325`) gain two rows: `["⌘⇧B", "scExplorer"]` and `["⌘⇧Y", "scSessions"]` → eight chords. **D5 confirms both.**

**Changes — `stage-states.js`:** delete `AGENTS` (`:17-21`), `boardRecents` (`:24-49`, already dead — nothing called `renderScene(1)`), `PRESET_CELLS` (`:52`) and `SIDEBAR_STATUS` (`:58-62`). Keep `PROOF_TERM_STEPS` (`:69-95`) and only the imports it still needs. The file becomes the closing band's terminal script and nothing else.

**Acceptance:** `grep -rn "renderScene\|boardRecents\|PRESET_CELLS\|SIDEBAR_STATUS\|tour__scenegrid" src/` → no hits; `PANELS.length === 6` and every `panel.scene` is a key of `SCENES`; the finale renders eight `.tour__sc`.

---

**T9 — copy, EN and VI** · lane C · depends on: nothing *(the panel list is fixed in §3.6)*

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

**R1 note:** the repo is English-only for code, comments, docs and commits. `copy.js`'s `vi` map is the landing's shipped localization and is the **one** place non-English strings live. **Scene-internal strings stay English** (spec §2, the 2026-07-16 stage spec) — a rail sentence, a command, a column header and a key hint are never translated.

**Acceptance:** `Object.keys(messages.en).sort()` deep-equals `Object.keys(messages.vi).sort()`; every `PANELS` key has a `Title` and a `Body` in both; `grep -n "tourCh" src/copy.js` → no hits; `grep -n "from folder to full formation" src/` → no hits.

---

**T10 — extract the appwin sheet** · lane D · depends on: T4

**Files:** new `marketing/landing-prototype/styles/appwin.css`, `marketing/landing-prototype/styles/direction-a.css`, `marketing/landing-prototype/src/main.js`, `marketing/video/src/main.js`

**Decision: split, unconditionally.** Spec §5 left it conditional. The rework roughly doubles a block that is already 408 contiguous lines inside a 1526-line file — frame row, rail (clusters, rows, leaves, the inset frame, four dot states, the spinner), strip (three chip kinds, three trailing controls), the 390px strategy and reduced motion. The split is mechanical and the extraction is provably clean: **all 70 `.a-appwin` occurrences in `direction-a.css` fall inside the four ranges below**, so the file is left with zero `.a-appwin` selectors.

**Move, verbatim:**
- `:484-891` — the whole appwin block (contiguous, self-contained).
- `:1235-1245` — `@keyframes a-appwin-blink`, `a-appwin-pulse`.
- `:1344-1377` — the appwin rules **inside** `@media (max-width: 47.5rem)`. **Re-wrap them in their own `@media (max-width: 47.5rem)` in the new file.**
- `:1425-1426` — the two selectors **inside** `@media (prefers-reduced-motion: reduce)`. **Re-wrap likewise.**

~450 lines move; `direction-a.css` lands near 1076.

**Register in BOTH entries — this is the trap:**
- `marketing/landing-prototype/src/main.js` — insert `import "../styles/appwin.css";` immediately after `tokens.css` (line 1). Sheets are registered by JS import order; `index.html:15` links only `base.css`. Placing the shared chrome sheet ahead of the three page sheets preserves today's cascade direction (a page sheet can still override).
- **`marketing/video/src/main.js:10` imports `../../landing-prototype/styles/direction-a.css`** — the video's `.a-appwin*` styling comes from the landing's sheet. Insert `import "../../landing-prototype/styles/appwin.css";` **immediately after** that line, keeping `video.css` last so its overrides still win. **Registering only the landing entry silently un-styles the entire video stage** — no error, no build failure, just a naked mock.

The moved rules read `--sg-*` (from `:root`) and `--a-font-display` / `--a-font-mono` (from `.direction-a` / `.tour` / `.vid-frame`), so the new sheet has **no token deps of its own** — but its import must come after `tokens.css` in both entries.

**Acceptance:** `grep -c "a-appwin" styles/direction-a.css` → 0; `npm run build:landing` clean; the built CSS bundle contains the same appwin rules as before the move (`grep -c "a-appwin" dist/assets/*.css` unchanged); the video entry renders a styled window.

---

### Phase 4 — Scene bodies and chrome styles
*Eight lanes, all concurrent. Six scene modules (created and frozen by T6), plus two disjoint stylesheets.*

---

**T11 — panel 1, `rail`** · lane A · depends on: T3, T6

**Files:** `src/tour/scenes/rail.js`

Rail column zoomed, stage side dimmed with the "the panes keep running" hint. Four clusters, covering **every** rail state the app has, all in legitimate resting frames:

1. Live, `framed: true` — three leaves: one `working` (the 14px ring), two `done` (**quiet gray dots**, D1). No parent row (D7). No selection wash on the framed item.
2. Live, bare — one `failed` row (red) and one `asked` row (yellow), each with its sentence and age.
3. **Collapsed** — caret **visible** (the one resting state in which it is, `04a:355-366`), no rows.
4. **Remembered**, `hovered: true` — `.asr-cluster__still`: folder + name, **no caret ever**, with `+` and `×` revealed. This is the plan's single baked hover state, and it is where the `+` gets said (D6).

Uses `renderStageRail` through `frame(body, { rail: <this fixture> })` — the scene does not hand-roll rail markup. Panel 1 is `flip: true`, so the rail sits on the reader's right.

**Acceptance:** the scene contains all five `data-state` values across its marks; exactly one `is-hover`; exactly one `is-collapsed`; exactly one `is-still` and it contains no `clustercaret`.

---

**T12 — panel 2, `picker`** · lane B · depends on: T3, T6

**Files:** `src/tour/scenes/picker.js`

⌘T quick picker over a blurred scrim. Verbatim from `agent-quick-picker.tsx:235-362` and `10-modals.css:255-314`:
- Panel: `width: min(420px, 90vw)`, `padding: 16px`, ground `--sg-rail`, `1px solid var(--sg-seam-raised)`, `border-radius: 12px`. Scrim: 42% wash of `--sg-bg` + `blur(10px)`.
- `<h1>Open a new tab</h1>` at 14px.
- **Destination row** — label `Worktree`, value `folder · branch` with a **middle dot U+00B7 and spaces on both sides** (`worktree-destinations.ts:79-83`), and a `CaretDown` hint. It is a **menu value**, not a text field.
- **Six agent rows**, a **column** not a wrapped grid (`.agent-quick-picker .agents { flex-direction: column }`), in `BUILTIN_AGENTS` order, each brand mark + the label text (`Claude Code`, `Codex`, `OpenCode`, `Antigravity`, `Gemini CLI`, `Cursor`), digit `index + 1`. Cursor is row **6** with the monogram — the digit contract is why it is last. The picker maps `AGENT_MARKS` directly, so T3 supplies the sixth row for free; this task's job is to route it through `renderAgentMark` so the markless entry does not throw.
- **The shell row.** `<button class="achip is-shell"><span class="shellmark">$</span>Shell only</button>`. The spec did not ask for it — but the key line literally says `0 shell`, and a key line naming a row that is not drawn is a lie.
- **The key-hint line, verbatim** (`:359-362`): `1–9 pick · 0 shell · ↑↓ Enter · Esc close`. **The dash between 1 and 9 is an EN DASH**; separators are `·`. The line is `--sg-fg-faint` and the `<kbd>`s inside it are **one step brighter** at `--sg-fg-dim` (`10-modals.css:306-314`). Getting that inversion backwards is the most likely error in this scene.

**Acceptance:** six `.achip` plus one `.is-shell`; digits 1–6 present and `cursor-agent` carries digit 6; the key line contains U+2013 and four `·`; exactly one `--mono` span.

---

**T13 — panel 3, `restore`** · lane C · depends on: T6

**Files:** `src/tour/scenes/restore.js`

Three panes typing their real resume commands. Per `COMMAND_TABLE` (`agent-resume.ts:39-74`), **id forms**:
- `claude --resume 0f3a91c2` — **no `--dangerously-skip-permissions`** (D3). Already correct in today's code; the spec introduced the error.
- `codex resume 019a4f1c` — changed from today's `codex resume --last`, which is the *latest* form.
- `opencode -s 3b77ae` — already correct.

Everything else in the scene is preserved: `RESTORE_PANES`, the per-element `--scene-delay` / `--scene-steps` inline CSS delays, the `data-restore-line` / `data-restore-type` hooks, and the reuse of `.a-appwin__promptbox` / `.a-appwin__cursor`. Rebuild on the new chrome: `frame(body, { rail: SCENE_RAIL, strip: <three chips> })`, no status bar.

**Acceptance:** the three commands appear exactly as above; `grep -n "dangerously-skip-permissions" src/tour/scenes/restore.js` → no hits.

---

**T14 — panel 4, `surfaces`** · lane D · depends on: T3, T6

**Files:** `src/tour/scenes/surfaces.js`

Keep the existing shape — unified strip, file tree, editor — and rebuild it on `renderStageStrip` instead of the scene's hand-rolled `SURFACE_TABS` markup, so the panel and the hero draw the same chip.

**New beat (spec §3):** a transcript path line rendered as a ⌘+click link, the editor open at that line. Ground truth is DL-14.7 / DL-23.11 (AGENTS.md 2026-08-20) — a path inside a workspace this window already has open lands in Deck's **own** editor as a preview tab, revealed at its line. Draw: transcript row `● Update(src/terminal/layout-engine.ts:214)` with the path in `--sg-accent`, underlined, and a small `⌘` cue; the editor pane open with row 214 marked. New classes `.scene-surfaces__link` and `.scene-surfaces__line.is-target`. **Do not draw the external-app split button** — it is Electron-only routing and outside the beat.

Note the file-chip detail the app has and the scene should keep: a preview tab's label is italic (`.tab__label--preview`).

**Acceptance:** exactly one `.scene-surfaces__link`; its text matches the editor's marked line number; the strip is `renderStageStrip` output, not hand-rolled.

---

**T15 — panel 5, `usage`** · lane E · **NEW** · depends on: T3, T6

**Files:** `src/tour/scenes/usage.js`

**Overview, not Daily** — the full decision and its four reasons are §1.2. Draw the left rail (`Overview · Daily · Breakdown`, Overview active), then Overview's body: eyebrow, the big figure, footnote, the range selector with `All` active, the estimate note, and two per-agent rows (Claude Code, Codex — the only two the scanner covers). Range labels verbatim: `Today · 7 days · 30 days · All`.

**No table. No `<thead>`. No column headers.** Those belong to Daily and Breakdown; the spec's composite does not exist.

`frame(body, { rail: SCENE_RAIL })` — the panel draws the dock's Usage tab, so it keeps the app rail beside it.

**Acceptance:** four range options with exactly one `is-active` and it is `All`; three nav items with exactly one active; zero `<table>`, `<thead>` or `<th>` elements; exactly two agent rows.

---

**T16 — panel 6, `catalog`** · lane F · **NEW** · depends on: T3, T6

**Files:** `src/tour/scenes/catalog.js`

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

**T17 — rail, strip and frame-row styles; the 390px strategy** · lane G · depends on: T4, T10

**Files:** `marketing/landing-prototype/styles/appwin.css`

The plan's largest CSS task. Everything is `cqw`-relative — `.a-appwin` is `container-type: inline-size`.

- **Planes:** `.a-appwin` ground `--sg-bg`; `.a-appwin__rail` and `.a-appwin__framerow` ground `--sg-rail`; `.a-appwin__sidebar + *` → `border-left: 1px solid var(--sg-seam-column)`. The rail's top-left corner is seamless with the frame row because both use `--sg-rail`.
- **Rail padding is asymmetric on purpose:** `8px 2px 7px 8px` in the app (`04a:63-72`), scaled to `cqw`. Do not "tidy" it.
- **Cluster header grid:** `minmax(0,1fr) 17px 17px`, `gap: 7px`, and **the two trailing tracks stay even when their ink is invisible** (§1.1). Reproduce `04a:373`'s reserved gutter.
- **Rest state:** `.a-appwin__clustercaret` and `.a-appwin__clusteradd` are `opacity: 0`; `.is-hover` and `.is-collapsed .a-appwin__clustercaret` are the only reveals.
- **Row geometry:** `17px minmax(0,1fr) auto 17px`, `gap: 2px 7px`, `min-height: 34px`, `padding: 6px 4px 6px 7px` (`04b:17-27`), scaled. The glyph and the close share cell 4.
- **Type:** name and sentence on the **same rung**, differing by tone alone (`--sg-fg` vs `--sg-fg-dim`). Age `--sg-fg-faint` with `font-variant-numeric: tabular-nums` — except the **leaf's** age, which is `--sg-fg-dim`.
- **The framed item:** `box-shadow: inset 0 0 0 1px var(--sg-hair-strong)`, `border-radius: var(--radius-control)` equivalent, `margin: 3px 0; padding: 3px 0`. **Inset shadow — not a border, not an outline.** The rationale is `04b:86-112`: a border bled the block past its container and `overflow-x: hidden` hid the symptom without removing the scroll container; an outline paints on the 1px *outside* and that same `hidden` clipped it. A headless item paints **no** selection wash and **no** accent bar.
- **The four dot states** (D1): 14px box in every state; `::before` is a centred 9px disc for `failed` / `asked` / `done` / `idle`; `[data-state="working"]` sets `::before { content: none }` and reveals the spinner. Colours per §2.2.
- **`wschase`**, copied from `02-shell.css:444-480`: `@keyframes wschase { from { opacity: 1 } to { opacity: 0.15 } }`, `animation: wschase 1.2s linear infinite`, `animation-delay: calc((var(--dot) - 8) * 0.15s)`. **Nothing rotates** — the geometry is still and a bright head appears to travel because eight dots run staggered opacity ramps.
- **Strip:** `height` = the frame row's height; `border-bottom: 1px solid var(--sg-hairline)` (**D2**, not `--sg-hairline-soft`); `.a-appwin__stripactions { margin-left: auto }`. Chips: a **three-step ladder**, `--sg-tab-rest` at rest → 6% hover → `--sg-raised` + a 1px `--sg-hair-strong` frame when active; a **1px transparent border is always present** so selection costs no height; `border-radius: 2px`; `max-width: 210px`; label `min-width: 0; overflow: hidden; text-overflow: ellipsis`.
- **Reduced motion** — add to the existing `@media (prefers-reduced-motion: reduce)` block: `.a-appwin__wsdot { animation: none; opacity: 0.5 }` and `.a-appwin__mark--spinner { opacity: 0.6 }`, mirroring `02-shell.css:474-479`. Missing this fails spec §8.4.

**The 390px strategy, decided.** `@media (max-width: 47.5rem)` currently carries `.a-appwin__sidebar { display: none }` — the entire mobile strategy, and directly against spec §8.2's demand for a legible rail at 390px.

> **At ≤47.5rem the rail STAYS and the pane grid drops to one pane.** `.a-appwin__sidebar { display: flex }` overrides the hide; the rail takes `42cqw`; `.a-appwin__grid` becomes one column showing the focused `claude` pane and the other two panes go `display: none`; the rail's sentence bottoms out at the 8px floor the transcript already uses; sentences truncate with `text-overflow: ellipsis`, exactly as `.asr-row__msg` does in the app.
>
> **Why not the alternatives.** Keeping `display: none` proves nothing about the rail, which is the whole subject of the redesign. A glyph-only collapsed rail is a **product state that does not exist** — the app's narrow behaviour is `sidebarCollapsed`, which takes the rail to width 0 (`settings-schema.ts:190`), and inventing a middle state is inventing a product. So the honest compression is **fewer panes, not less rail**, and a truncated sentence is the app's own behaviour rather than a mock defect.
>
> Also restore the seam: the companion rule `.a-appwin__sidebar + * { border-left: none }` at `:1362` must go too, or the stage loses its structural line at exactly the width where the rail is hardest to read.
>
> 390px is a **marketing-page** check width. The app's own minimum is 480px; this plan makes no claim about the app at 390.

**Acceptance:** `npm run build:landing` clean; at 1440 the hero rail shows three clusters with zero visible carets and zero visible `+`; at 390 the rail is visible, the stage shows one pane, and the page has no horizontal scrollbar; with reduced motion forced, no `.a-appwin__wsdot` animates.

---

**T18 — monogram styles and the agent strip** · lane H · depends on: T10

**Files:** `marketing/landing-prototype/styles/direction-a.css`

- `.agent-strip__mark--mono` — the Cursor monogram: a `--sg-chrome-2` disc, `--sg-fg-dim` ink, 9px/600, grid-centred, matching the `<img>`'s 20px box so the strip's rhythm does not shift. **No brand tint** (T3).
- The same treatment for the scene-side sizes the shared helper emits (18px and 15px).
- Nearest existing idioms for reference: `.a-appwin__wslogo--mono` (`:639-647`) and `.tour__agentchip` with `--chip-tint` (`tour.css:411-423`). Both are tinted; this one deliberately is not.

**Acceptance:** the strip's sixth chip aligns on the same baseline and box as the other five; no `--ws-tint` or `--chip-tint` is read by the new rules.

---

### Phase 5 — Scene styles
*Lanes A/B concurrent. Two disjoint stylesheets. Sequenced after Phase 4 so both style markup that exists.*

---

**T19 — scene styles** · lane A · depends on: T11–T16

**Files:** `marketing/landing-prototype/styles/scenes.css`

- Rework the four existing blocks — `restore` (`:40-149`), `rail` (`:151-308`), `picker` (`:310-439`), `surfaces` (`:441-571`) — onto the new tokens and the new chrome. `.scene-surfaces__editor` is **declared twice today** (`:519` and `:533`); collapse it.
- Add two new blocks for `usage` and `catalog`.
- Add the surfaces link beat's two rules (T14).
- **Add every new scene's reveal animation to the reduced-motion list at `:573-580`.** That list currently names four selectors. Any new reveal missing from it fails spec §8.4 with no error.
- Panel 5's range selector: the active option is a 4% `--fg` wash — **no pill, no shadow** (`12-usage.css:428-458`).

**Acceptance:** every `.panel.is-revealed` animation defined in the file appears in the reduced-motion block; `grep -c "scene-surfaces__editor {" ` → 1; `npm run build:landing` clean.

---

**T20 — panel scaffolding and plates** · lane B · depends on: T8

**Files:** `marketing/landing-prototype/styles/tour.css`

- Plate rules: delete `[data-scene="grid"]` (`:261`); add `[data-scene="usage"]` → `--plate-plateau` and `[data-scene="catalog"]` → `--plate-cloudstudy` at `background-position: 68% 22%`. Keep rail/restore/picker/surfaces.
- **Amend the comment at `:257-259`** — it claims *"these five never repeat it or each other"*, which panel 6 breaks. Record the reuse and why (six panels, five available plates, no new asset).
- Delete the stranded board CSS: `.tour__board*` (`:307`), `.tour__recents` / `.tour__recent` (`:332-355`), `.tour__thumb*` (`:356-385`), `.tour__agentchip` (`:411`), `.tour__openkbd` (`:425`), `.tour__scenegrid .a-appwin__pane` (`:440`).
- Delete `.tour .a-appwin__wsavatar[data-ws-status=…]` (`:446-472`) — the tour no longer calls `renderStageSidebar`, so these are dead. **The video keeps its own copy at `video.css:350-397`; do not touch that file.**
- Keep `.panel__art .a-appwin` (`:291`) and the `.tour` scope's `--a-*` aliases (`:12-29`) — the shared chrome resolves through them outside `.direction-a`. **Any new `.a-appwin__*` rule that reads an `--a-*` var must have an alias in all three scopes** (`.direction-a`, `.tour`, `.vid-frame`); prefer `--sg-*`, which needs none.

**Acceptance:** six `[data-scene=…] .panel__stage-art` rules matching §3.6; `grep -n "tour__board\|tour__recent\|tour__thumb\|tour__openkbd\|tour__scenegrid\|wsavatar" styles/tour.css` → no hits.

---

### Phase 6 — Verification and records

**T21 — gates, the one new test, and the record** · depends on: everything

**Files:** new `marketing/landing-prototype/src/stage-markup.test.js`, `docs/CONTEXT.md`, `AGENTS.md`, this plan

Full detail in §6. In short: run gates 1, 2 and 4; write the contract test; assemble screenshots; hand gates 3 and 5 to the owner; record what is verified and what is owed, including the video's colour drift (§2.4).

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
npm run lint
```
Expect clean and green. **State plainly in the report that none of the pre-existing landing tests touches the stage** — they prove the changelog and download paths still work, nothing more. The two video tests (`transcript.test.js`, `timeline.test.js`) DO read `stagePanes` and are the real regression signal for T1.

**Because gate 1 proves so little, this plan adds one test.** `marketing/landing-prototype/src/stage-markup.test.js` — pure string assertions over the renderers, no jsdom needed for most of it, picked up by the existing `marketing/**/*.test.js` include glob. It pins **the seams the rewrite can silently break**, not appearance:

1. Every `[data-tail]` / `[data-dot]` value in the hero markup matches a `[data-stream]` id.
2. Every `SCENES` key has a `PANELS` entry and vice versa.
3. Every `PANELS` key has a `Title` and a `Body` in **both** locales, and `Object.keys(messages.en)` matches `Object.keys(messages.vi)`.
4. No renderer emits `undefined`, `null`, `NaN` or `[object Object]`.
5. `renderStageRail` of a `remembered` cluster emits no caret; of a `framed` tab emits N leaves and zero rows.
6. Under `prefers-reduced-motion`, `renderStaticFrame` leaves each mark at its pane's **last** `state` and each `[data-tail]` at its **last** `tail` (this is gate 4, made automatic).
7. `AGENT_MARKS` has six entries, `cursor-agent` last, and no renderer emits `src="null"`.

That is roughly 80 lines and it is **the only automated signal that this rewrite is wired**. Owned by T21.

### Gate 2 — screenshots at 1440, 768, 390 — **obtainable here**

`findChromium()` **resolves in this environment**: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, and `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell` exists. Confirm before starting:

```
ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium_headless_shell-*/chrome-linux/headless_shell
```

Then add `scripts/capture-landing-stage.mjs`, modelled on `marketing/video/render/capture.mjs` (import `findChromium`, do not re-implement it). This is idiomatic — the repo already carries two ad-hoc capture scripts (`scripts/capture-updater-preview.mjs`, `scripts/verify-electron-gate-m-package.mjs`). It should: serve the built `dist/`, visit the landing, and shoot the hero plus each of the six panels at 1440 / 768 / 390, **twice** — once normally and once with `prefers-reduced-motion: reduce` emulated, which produces gate 4's evidence in the same run.

Checks on the output: the smallest rail sentence is legible at 390; **no horizontal overflow at any width** (assert `document.documentElement.scrollWidth <= innerWidth` in-page, cheaper and stricter than reading a picture).

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
| R1 | **`.a-appwin__sidebar` renamed** → the stage's only structural seam vanishes in hero + tour + video, and the mobile rule stops matching. No error anywhere. | `grep -c "a-appwin__sidebar" styles/appwin.css` ≥ 3, and one screenshot showing the vertical line. Prevented by design: §3.3 rule 1 keeps the class. |
| R2 | **`appwin.css` registered only in the landing entry** → the whole video stage renders unstyled. Builds fine. | `grep -n "appwin.css" marketing/video/src/main.js` → 1 hit. |
| R3 | **A name dropped from `product-stage.js:18` or the shim's export list** → immediate ESM link error, and for `product-stage.js` it is the **landing** that fails, not just the video. | `npm run build:landing`. It is loud — the one failure mode in this plan that is. |
| R4 | **`renderStaticFrame` not widened** → reduced-motion users see a rail with the pane's *first* sentence and an out-of-date dot forever. Nothing errors. | New-test assertion 6. |
| R5 | **A new scene's reveal animation missing from `scenes.css:573-580`** → it animates under `prefers-reduced-motion: reduce`. Fails spec §8.4 silently. | Every `.panel.is-revealed` selector in the file also appears in the reduce block. Greppable. |
| R6 | **The cluster header's two trailing 17px tracks collapsed** when their ink is invisible → the header's name column stops in a different place from the rows', reproducing the exact 11px overflow the owner caught on 2026-08-19. | One screenshot with a straight edge on the name column; or assert the grid template in CSS. |
| R7 | **`data-tail` looked up with `querySelector`** instead of `querySelectorAll` → the rail updates and the strip chip does not, or vice versa. Half-alive. | New-test assertion 1, plus watching both change in one loop. |
| R8 | **The hook lookup widened to `document`** → collides across mounts the moment a second panel gets a grid. Invisible today because there is exactly one mount. | `grep -n "document.querySelector" src/product-stage.js` → only the pre-existing engine internals. |
| R9 | **A markless agent reaching a bare `<img>`** — three renderers do this, not one. | `grep -rn 'src="\${agent.mark}"' src/` → no hits after T3. |
| R10 | **`tourKicker` left as "// from folder to full formation"** → the section label advertises the panel that was cut. | `grep -n "full formation" src/copy.js` → no hits. |
| R11 | **VI copy drifting from EN** — a missing key renders `undefined` in one locale only, and nobody browses in the other. | New-test assertion 3. |
| R12 | **Percentage size + padding without `box-sizing`** — the AGENTS.md trap. The landing has a global reset (`base.css:14-16`) but it is linked from `index.html:15`, **not imported by `main.js`** — so any jsdom test or standalone harness renders with **no reset**. | Declare `box-sizing: border-box` explicitly on every new element given a percentage size and a padding. Do not rely on the page reset. |
| R13 | **A 1px overflow inside a scroll container moves the whole shell** — the second AGENTS.md trap, and the exact bug the DL-27.19 frame hit twice. | Prevented by using the **inset box-shadow**, never a border or an outline, on `.is-framed`. Assert `scrollWidth <= innerWidth` in the gate-2 run. |
| R14 | **`--sg-hairline-soft` set to the app's solid `--sidebar-seam`** → pane borders nearly vanish on the landing **and** three `video.css` rules change. | §2.1 keeps it an alpha. `grep -rn "sg-hairline-soft" marketing/` shows all six consumers before editing. |
| R15 | **A new `.a-appwin__*` rule reading an `--a-*` var** → undefined in the `.tour` or `.vid-frame` scope; only `--a-font-display` / `--a-font-mono` are aliased in all three. | Prefer `--sg-*` exclusively in `appwin.css`. Grep the new sheet for `var(--a-` → only the two font vars. |
| R16 | **Two agents editing one file.** | §4 is the contract. Before starting a task, `git status --short` and confirm no other lane's files are dirty. |

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
- **`stage-data.js`'s `stageSidebar`.** Kept, video-only, commented.
- **A seventh `--plate-*` asset.** Panel 6 reuses `cloudstudy` at a new crop (§3.6).
- **A Playwright *test runner*.** Gate 2 is a one-off capture script reusing `findChromium()`, not `@playwright/test` + a config + a CI job. Standing up a runner is its own decision.
- **A Cursor brand tint.** Neutral monogram until the app ships a mark and a colour.
- **Splitting `scenes.css`.** One owner, sequenced (§4).
- **Any `docs/DESIGN-LANGUAGE.md` amendment.** DL binds app chrome. This work is a drawing of chrome that already obeys it.
