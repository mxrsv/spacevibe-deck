/* =====================================================================================
   dock.js: builders for the Dock tab (dock.html). Everything here composes chrome.css recipes
   and Deck helpers; no colour, size or state is written here. Global: window.DockMock.
     DockMock.entries(data, worst)   changed files (65 in worst)
     DockMock.columns(data, worst)   [[caption, html]] full dock columns
     DockMock.states(data, worst)    [[caption, html]] empty / loading / error bodies
     DockMock.matrix(data)           html: state sheet for strip cell, tab, tree row, card header, history row
   ===================================================================================== */
(function () {
  "use strict";
  const D = window.Deck,
    esc = D.esc,
    icon = D.icon;
  const FORCE = {
    hover: "is-hover",
    focus: "is-focus",
    selected: "is-selected",
    pressed: "is-pressed",
    disabled: "is-disabled",
    dragover: "is-dragover",
  };
  const f = (s) =>
    s
      ? s
          .split(" ")
          .map((x) => FORCE[x] || x)
          .join(" ")
      : "";
  const num = (n) => Number(n).toLocaleString("en-US");
  const M = (window.DockMock = {});

  /* ---------- data ---------- */
  M.entries = (data, worst) => {
    const base = data.changes;
    if (!worst) return base.map((e) => ({ ...e }));
    return Array.from({ length: 65 }, (_, i) => ({
      ...base[i % base.length],
      path: base[i % base.length].path.replace(/(\.[a-z]+)?$/, `-${i}$1`),
      binary: i === 9,
    }));
  };
  const totals = (es) =>
    es.reduce((t, e) => ({ add: t.add + e.add, del: t.del + e.del }), { add: 0, del: 0 });
  const isOpen = (i, worst) => (worst ? i < 3 || i === 4 : ![1, 3, 5].includes(i));

  /* ---------- parts ---------- */
  const counts = D.counts; // +a −d in tabular numerals; a zero side is neutral ink (DOCK-8)
  // repo-relative path: the folder clips from the left (rtl box, ltr run), the name keeps its width (DOCK-10)
  const pathHTML = (p, del) => {
    const i = p.lastIndexOf("/"),
      dir = i < 0 ? "" : p.slice(0, i),
      name = p.slice(i + 1);
    return (
      (dir
        ? `<span dir="rtl" class="t-ellipsis t-muted"><bdi dir="ltr">${esc(dir)}</bdi></span><span class="t-muted none">/</span>`
        : "") +
      `<span class="dk-name t-ellipsis t-strong">${del ? `<s>${esc(name)}</s>` : esc(name)}</span>`
    );
  };
  const head = (e, { open = true, state = "" } = {}) => {
    const del = e.status === "D";
    const crumb = del
      ? `<span class="crumb" aria-disabled="true">${pathHTML(e.path, true)}</span>`
      : `<button class="crumb" title="${esc(e.path)}">${pathHTML(e.path, false)}</button>`;
    return `<div class="card-head"><div class="row row-24 ${f(state)}" role="group" aria-label="${esc(e.path)}${del ? " (deleted)" : ""}">${D.iconButton({ icon: open ? "caretDown" : "caretRight", size: 20, label: (open ? "Fold " : "Unfold ") + e.path, attrs: `aria-expanded="${open}"` })}${crumb}<span class="grow"></span>${e.binary ? '<span class="t-meta none">binary</span>' : counts(e.add, e.del)}${del ? "" : D.iconButton({ icon: "external", size: 20, label: "Open in File", cls: "ib-hit" })}</div></div>`;
  };
  const linesFor = (e, i, data) => {
    const src = data.diffs[i % data.diffs.length].lines;
    return e.status === "D" ? src.slice(0, 3).map((l) => ({ n: l.n, t: "del", x: l.x })) : src;
  };
  const diffBody = (e, lines) => {
    if (e.binary) return `<div class="t-meta pad-8">Binary file, no preview.</div>`;
    const n0 = lines[0].n,
      c = lines.length;
    return D.diff(lines, { hunk: `@@ -${n0},${c} +${n0},${c} @@` });
  };
  // .card-head is the shared 24 sticky head on an opaque ground; flash: the card a list-pane press landed on
  const card = (e, i, data, open, flash) =>
    `<div class="card${flash ? " is-flash" : ""}" data-card="${esc(e.path)}">${head(e, { open })}${open ? diffBody(e, linesFor(e, i, data)) : ""}</div>`;

  /* ---------- the 40px band, one per view (DOCK-7) ---------- */
  const band = (inner) => `<div class="bar bar-band">${inner}</div>`;
  const changesBand = (es, { list, roomy }) => {
    const t = totals(es);
    return band(
      `<span class="t-strong none">Uncommitted</span>${es.length ? `<span class="flex gap-6 grow minw0 dk-clip"><span class="t-meta t-num none">${num(es.length)} files</span>${counts(t.add, t.del)}</span>` : '<span class="grow"></span>'}${roomy ? D.iconButton({ icon: "sidebarLeft", label: "Show file navigation", state: list ? "selected" : "", attrs: `aria-pressed="${list}"` }) : ""}${D.iconButton({ icon: "refresh", label: "Refresh changes" })}`,
    );
  };
  const usageBand = (repo) =>
    band(
      `<span class="t-strong none">Today</span><span class="t-meta t-ellipsis grow">${esc(repo)}</span>${D.iconButton({ icon: "info", label: "What these figures cover" })}${D.iconButton({ icon: "external", label: "Usage details" })}`,
    );
  const historyBand = (label, n) =>
    band(
      `<span class="t-strong t-ellipsis">${esc(label)}</span><span class="t-meta t-num none grow">${n == null ? "" : num(n)}</span>${D.iconButton({ icon: "refresh", label: "Rescan sessions" })}`,
    );
  const filesBand = () =>
    band(
      `${D.field({ icon: "search", placeholder: "Search files", size: 28, cls: "grow" })}${D.iconButton({ icon: "refresh", label: "Refresh files" })}${D.iconButton({ icon: "folderAdd", label: "New file" })}`,
    );

  /* ---------- the strip: view icons, a gap, file tabs, +, widen, close ---------- */
  const tab = ({ name, state = "", preview, dirty }) =>
    D.tab({ title: name, icon: "fileText", state, preview, dirty, compact: true });
  const VIEWS = [
    ["changes", "fileEdit", "Changes"],
    ["usage", "usage", "Usage"],
    ["history", "clock", "History"],
    ["files", "folder", "Files"],
  ];
  const strip = ({ view, tabs = "", maxd = false, widenOff = false }) =>
    `<div class="bar bar-strip" role="toolbar" aria-label="Dock views">${VIEWS.map(([id, ic, l]) => D.iconButton({ icon: ic, label: l, state: id === view ? "selected" : "", attrs: `aria-pressed="${id === view}"` })).join("")}<div class="tabstrip grow bar-gap" role="tablist" aria-label="Open files">${tabs}</div>${D.iconButton({ icon: "plus", label: "Open a file" })}${D.iconButton({ icon: maxd ? "shrink" : "expand", label: maxd ? "Restore the panel width" : "Widen the panel", state: widenOff ? "disabled" : "" })}${D.iconButton({ icon: "caretRight", label: "Hide the side panel" })}</div>`;
  const ask = (text) =>
    `<div class="pad-8"><div class="card is-needs pad-12 col gap-8"><p class="t-wrap">${esc(text)}</p><div class="flex">${D.button({ label: "Open pane", size: 28 })}</div></div></div>`;
  const col = (w, inner, cls = "") =>
    `<div class="win-dock dk-w${w} dk-tall ${cls}">${inner}</div>`;

  /* ---------- Changes ---------- */
  const tree = (es) => {
    const root = { dirs: new Map(), files: [] };
    for (const e of es) {
      const parts = e.path.split("/"),
        name = parts.pop();
      let n = root;
      for (const p of parts) {
        if (!n.dirs.has(p)) n.dirs.set(p, { dirs: new Map(), files: [] });
        n = n.dirs.get(p);
      }
      n.files.push({ ...e, name });
    }
    return root;
  };
  const countFiles = (n) =>
    n.files.length + [...n.dirs.values()].reduce((s, c) => s + countFiles(c), 0);
  const walk = (n, depth, out, closedFn, pressed) => {
    for (const [key, first] of n.dirs) {
      let d = first,
        label = key;
      while (d.files.length === 0 && d.dirs.size === 1) {
        const [k, c] = [...d.dirs][0];
        label += "/" + k;
        d = c;
      }
      const closed = closedFn(label, out.length);
      out.push(
        `<button class="row row-24 tree-row" style="--depth:${depth}" aria-expanded="${!closed}">${icon(closed ? "caretRight" : "caretDown", 12)}<span class="row-title grow" title="${esc(label)}">${esc(label)}</span>${closed ? `<span class="tree-status">${num(countFiles(d))}</span>` : ""}</button>`,
      );
      if (!closed) walk(d, depth + 1, out, closedFn, pressed);
    }
    for (const e of n.files)
      out.push(
        `<button class="row row-24 tree-row${e.name === pressed ? " is-selected" : ""}" style="--depth:${depth}"><span class="dk-ph"></span><span class="row-title grow ${e.status === "D" ? "t-muted" : ""}">${e.status === "D" ? `<s>${esc(e.name)}</s>` : esc(e.name)}</span></button>`,
      );
  };
  const changesTree = (es, worst, pressed) => {
    const out = [];
    walk(tree(es), 0, out, (l, i) => (worst ? i % 5 === 3 : /^(styles|docs)/.test(l)), pressed);
    return `<div class="col gap-2 pad-8" role="group" aria-label="Changed files">${out.join("")}</div>`;
  };
  const changesBody = (data, es, worst, { list = false, roomy = false, stuck = false } = {}) => {
    const flashAt = list ? 0 : -1; // the list pane's selected file flashes its card
    const cards = es.map((e, i) => card(e, i, data, isOpen(i, worst), i === flashAt)).join("");
    return (
      changesBand(es, { list, roomy }) +
      `<div class="dk-body flex stretch">${list ? `<div class="dk-pane scroll">${changesTree(es, worst, es[flashAt] && es[flashAt].path.split("/").pop())}</div>` : ""}<div class="scroll grow" data-stack="${stuck ? "stuck" : ""}"><div class="col gap-8 pad-8" role="group" aria-label="File diffs">${cards}</div></div></div>`
    );
  };

  /* ---------- Usage ---------- */
  const fact = (ic, value, label) =>
    `<div class="card pad-8" title="${label}" aria-label="${label}: ${esc(value)}"><div class="flex gap-6">${icon(ic, 14, "ico-muted")}<span class="t-strong t-ellipsis t-num">${esc(value)}</span></div></div>`;
  const meter = D.meter;
  const usageBody = (data, worst) => {
    const [a, b] = data.usage;
    const agentCard = (u) =>
      `<div class="card pad-12 col gap-12"><div class="flex gap-8">${D.ring(u.windows[0].pct, u.agent)}<span class="t-strong t-ellipsis grow">${esc(u.label)}</span><span class="t-meta t-num none">${esc(u.tokens)} · ${esc(u.cost)}</span></div>${u.windows.map((w) => `<div class="col gap-4"><div class="dk-win"><span class="t-meta">${esc(w.name)}</span>${meter(w.pct, w.pct >= 100 ? "fail" : w.pct >= 80 ? "warn" : "")}<span class="t-meta t-num">${w.pct}%</span></div><span class="t-meta t-ellipsis">${esc(w.resets)}</span></div>`).join("")}</div>`;
    return (
      usageBand("spacevibe-deck") +
      `<div class="dk-body scroll"><div class="col gap-8 pad-8"><div class="dk-facts">${fact("coins", a.tokens, "Tokens today")}${fact("dollar", a.cost, "Cost today")}${fact("userGroup", b.cost, "Space cost today")}${fact("timer", worst ? "99h 59m" : "2h 14m", "Running for")}</div>${agentCard(a)}${agentCard(b)}</div></div>`
    );
  };

  /* ---------- History ---------- */
  const hrow = (title, when, state = "") =>
    `<button class="row row-32 ${f(state)}" aria-label="Resume ${esc(title)}"><span class="row-title grow">${esc(title)}</span><span class="row-when">${esc(D.age(when))}</span></button>`;
  const historyBody = (data) =>
    historyBand("Claude Code", data.history.length) +
    `<div class="dk-body scroll"><div class="col gap-2 pad-8" aria-label="Past Claude Code sessions">${data.history.map((h) => hrow(h.title, h.when)).join("")}</div></div>`;

  /* ---------- Files: explorer tree, editor, external-change bar ---------- */
  const PROJ = [
    ["dist-monaco-smoke-renderer", 0, 1, { ignored: 1 }],
    ["docs", 0, 1],
    ["electron", 0, 1],
    ["node_modules", 0, 1, { ignored: 1 }],
    ["scripts", 0, 1],
    ["src", 0, 1, { open: 1, dot: 1 }],
    ["assets", 1, 1],
    ["files", 1, 1, { open: 1, dot: 1 }],
    ["changes", 2, 1],
    ["ui", 2, 1, { open: 1, dot: 1 }],
    ["rail-row.tsx", 3, 0, { sel: 1 }],
    ["changes-list.tsx", 3, 0],
    ["diff-column.tsx", 3, 0],
    ["styles", 1, 1, { dot: 1 }],
    [".gitignore", 0, 0, { ignored: 1 }],
    ["package.json", 0, 0],
  ];
  const projRow = ([name, depth, dir, o = {}], state = "") =>
    `<button class="row row-24 tree-row ${o.sel ? "is-selected" : ""} ${o.ignored ? "is-ignored" : ""} ${f(state)}" style="--depth:${depth}">${dir ? icon(o.open ? "caretDown" : "caretRight", 12) : icon("fileText", 12)}<span class="row-title grow">${esc(name)}</span>${o.dot ? '<span class="dot is-need" aria-label="Contains changes"></span>' : ""}</button>`;
  const projTree = (data, worst) => {
    const extra = worst
      ? [
          [data.fileTabs[3].name, 3, 0],
          [data.fileTabs[4].name, 3, 0, { ignored: 1 }],
          [data.fileTabs[5].name, 1, 1, { dot: 1 }],
        ]
      : [];
    return `<div class="col gap-2 pad-8" role="tree" aria-label="Project files">${[...PROJ, ...extra].map((r) => projRow(r)).join("")}</div>`;
  };
  const CODE = [
    'import { signal } from "@preact/signals";',
    'import { RailStatusMark } from "./controls/mark";',
    "",
    "const ROW_HEIGHT = { rail: 44, dock: 24 };",
    "",
    "export function RailRow({ row }: Props) {",
    "  const mark = <RailStatusMark state={row.state} />;",
    "  return (",
    '    <button class="row row-44">',
    "      {mark}",
    '      <span class="row-title">{row.title}</span>',
    "    </button>",
    "  );",
    "}",
    "",
    "export const railRowHeight = ROW_HEIGHT.rail;",
  ];
  const editor = (worst) =>
    `<div class="panes grow"><div class="pane"><pre class="term dk-code">${CODE.map((l, i) => `<span class="mu">${String(i + 1).padStart(2)}</span>  ${esc(l)}`).join("\n")}${worst ? `\n<span class="mu">${CODE.length + 1}</span>  // ${"unbroken-comment-".repeat(14)}` : ""}</pre></div></div>`;
  const crumbs = (data, worst) => {
    const parts = worst
      ? ["…", data.fileTabs[3].name, data.fileTabs[4].name, data.fileTabs[5].name]
      : ["spacevibe-deck", "src", "ui", "rail-row.tsx"];
    const last = parts.pop();
    return `<nav class="crumbs grow dk-crumbs" aria-label="File path">${parts.map((p) => `<button class="crumb">${esc(p)}</button>${icon("caretRight", 12, "ico-faint")}`).join("")}<button class="crumb t-strong">${esc(last)}</button></nav>`;
  };
  const fileBand = (data, worst, tree) =>
    band(
      `${crumbs(data, worst)}${D.button({ icon: "external", iconEnd: "caretDown", size: 28, attrs: 'aria-label="Open in"' })}${D.iconButton({ icon: "list", label: "Wrap lines" })}${D.iconButton({ icon: "tree", label: tree ? "Hide the file tree" : "Show the file tree", state: tree ? "selected" : "", attrs: `aria-pressed="${tree}"` })}`,
    );
  const extBar = (name) =>
    `<div class="notice notice-warn wrap dk-notice" role="status">${icon("alertCircle", 16)}<span class="notice-text t-wrap">${esc(name)} changed on disk and you have unsaved changes.</span><span class="flex gap-8 end">${D.button({ label: "Reload", size: 28 })}${D.button({ label: "Keep mine", size: 28, variant: "primary" })}</span></div>`;
  const fileBody = (data, worst, tree) =>
    fileBand(data, worst, tree) +
    extBar(data.fileTabs[0].name) +
    `<div class="dk-body flex stretch">${editor(worst)}${tree ? `<div class="dk-pane scroll">${projTree(data, worst)}</div>` : ""}</div>`;

  /* ---------- the columns ---------- */
  const edge = (n, worst) =>
    `<div class="win-dock dk-edge dk-tall"><div class="bar bar-strip"></div><div class="col gap-8 dk-edge-in">${D.iconButton({ icon: "sidebarRight", label: "Open the side panel" })}${D.mark(worst ? "failed" : "needs")}<span class="t-meta t-num">${n > 99 ? "99+" : n}</span></div><div class="dk-edge-in col dk-edge-foot">${D.iconButton({ icon: "close", label: "Hide the side panel" })}</div></div>`;
  M.columns = (data, worst) => {
    const es = M.entries(data, worst);
    const tabs = (active) =>
      data.fileTabs
        .map((t, i) =>
          tab({
            name: t.name,
            dirty: t.dirty,
            preview: i === 2,
            state: i === active ? "selected" : "",
          }),
        )
        .join("");
    const askText = data.attention[worst ? 6 : 0].ask;
    return [
      [
        "Changes, 360: card stack, first header stuck, folded and unfolded",
        col(
          360,
          strip({ view: "changes", tabs: tabs(-1) }) +
            changesBody(data, es, worst, { stuck: true }),
        ),
      ],
      [
        "Usage, 360, with the Ask banner above the strip",
        col(360, ask(askText) + strip({ view: "usage", tabs: tabs(-1) }) + usageBody(data, worst)),
      ],
      ["History, 360", col(360, strip({ view: "history", tabs: tabs(-1) }) + historyBody(data))],
      [
        "Files, 360: explorer tree, ignored dimmed, dot on folders with changes",
        col(
          360,
          strip({ view: "files", tabs: tabs(-1) }) +
            filesBand() +
            `<div class="dk-body scroll">${projTree(data, worst)}</div>`,
        ),
      ],
      [
        "File tab, 360: tree pane hidden below 560, external-change bar",
        col(360, strip({ view: "", tabs: tabs(0) }) + fileBody(data, worst, false)),
      ],
      [
        "Edge handle, narrow window",
        `<div class="flex gap-24 top">${edge(worst ? 99999 : es.length, false)}${edge(0, true)}</div>`,
      ],
      [
        "Changes, 560 (widened): list pane on, 40% of the body",
        col(
          560,
          strip({ view: "changes", tabs: tabs(-1), maxd: true }) +
            changesBody(data, es, worst, { list: true, roomy: true }),
        ),
      ],
      [
        "File tab, 560: editor, tree pane toggled on",
        col(560, strip({ view: "", tabs: tabs(0), maxd: true }) + fileBody(data, worst, true)),
      ],
    ];
  };

  /* ---------- empty, loading and error bodies ---------- */
  const empty = (ic, text) =>
    `<div class="empty">${icon(ic, 16, "ico-faint")}<span class="t-wrap">${esc(text)}</span></div>`;
  const short = (inner) => `<div class="win-dock dk-w360 dk-short">${inner}</div>`;
  const tiles = `<div class="col gap-8 pad-8" aria-busy="true"><div class="dk-facts">${'<div class="card pad-12"><span class="skel"></span></div>'.repeat(4)}</div><div class="card pad-12 col gap-12"><span class="skel"></span><span class="skel"></span></div></div>`;
  M.states = (data, worst) => [
    [
      "changes · empty",
      short(changesBand([], { roomy: false }) + empty("diff", "No changes against HEAD.")),
    ],
    [
      "changes · loading",
      short(
        changesBand([], { roomy: false }) +
          `<div class="pad-8" aria-busy="true">${D.skeleton(4)}</div>`,
      ),
    ],
    [
      "changes · not a git repository",
      short(changesBand([], { roomy: false }) + empty("branch", "Not a git repository.")),
    ],
    ["usage · empty", short(usageBand("") + empty("usage", "Focus an agent to see its usage."))],
    ["usage · loading", short(usageBand("spacevibe-deck") + tiles)],
    [
      "history · empty",
      short(
        historyBand("Claude Code", 0) +
          empty(
            "clock",
            worst
              ? "No Claude Code sessions in " + data.projects[0].path
              : "No Claude Code sessions in ~/Development/spacevibe-deck.",
          ),
      ),
    ],
    [
      "history · loading",
      short(
        historyBand("Claude Code", null) +
          `<div class="pad-8" aria-busy="true">${D.skeleton(4)}</div>`,
      ),
    ],
    [
      "history · error",
      short(
        historyBand("Claude Code", null) +
          `<div class="pad-8"><div class="notice notice-fail">${icon("alertCircle", 16)}<span class="notice-text t-wrap">${worst ? esc(data.notices.persist) : "Could not read this machine's sessions."}</span>${D.button({ label: "Retry", size: 28 })}</div></div>`,
      ),
    ],
    ["files · no folder", short(filesBand() + empty("folder", "No folder to show."))],
    [
      "files · loading",
      short(filesBand() + `<div class="pad-8" aria-busy="true">${D.skeleton(4)}</div>`),
    ],
  ];

  /* ---------- state sheet: strip cell, file tab, tree row, card header, history row ---------- */
  const STATES = [
    ["rest", ""],
    ["hover", "hover"],
    ["focus-visible", "focus"],
    ["selected", "selected"],
    ["selected + focus", "selected focus"],
    ["pressed", "pressed"],
    ["disabled", "disabled"],
    ["drag-over", "dragover"],
  ];
  M.matrix = (data) => {
    const e0 = data.changes[0],
      e4 = data.changes[4];
    const group = (title, colw, make, na = []) =>
      `<section><h3 class="gx-h">${title}</h3><div class="win-dock dk-bed pad-16"><div class="gx-grid" style="--gx-col:${colw}px">${STATES.map(([n, s]) => `<div class="gx-cell fill"><span class="gx-cap">${n}</span>${na.includes(n) ? '<span class="gx-cap">n/a</span>' : make(s)}</div>`).join("")}</div></div></section>`;
    return [
      group("strip cell (view icon)", 120, (s) =>
        D.iconButton({ icon: "fileEdit", label: "Changes", state: s }),
      ),
      group("strip cell (widen, disabled when the window is too narrow)", 120, (s) =>
        D.iconButton({ icon: "expand", label: "Widen the panel", state: s }),
      ),
      group(
        "file tab: kept, dirty (preview tab in italic on the last row)",
        170,
        (s) =>
          `<div class="col gap-4 fill">${tab({ name: data.fileTabs[0].name, dirty: true, state: s })}${tab({ name: data.fileTabs[2].name, preview: true, state: s })}</div>`,
      ),
      group(
        "tree row: folder closed with count, file, deleted file",
        190,
        (s) =>
          `<div class="col gap-2 fill"><button class="row row-24 tree-row ${f(s)}" style="--depth:0">${icon("caretRight", 12)}<span class="row-title grow">styles</span><span class="tree-status">3</span></button><button class="row row-24 tree-row ${f(s)}" style="--depth:0"><span class="dk-ph"></span><span class="row-title grow">rail-row.tsx</span></button><button class="row row-24 tree-row ${f(s)}" style="--depth:0"><span class="dk-ph"></span><span class="row-title grow t-muted"><s>legacy-card.tsx</s></span></button></div>`,
      ),
      group(
        "card header: unfolded, folded and deleted",
        250,
        (s) =>
          `<div class="col gap-4 fill"><div class="card">${head(e0, { open: true, state: s })}</div><div class="card">${head(e0, { open: false, state: s })}</div><div class="card">${head(e4, { open: false, state: s })}</div></div>`,
        ["selected", "selected + focus"],
      ), // a card header folds; it is never selected
      group(
        "explorer row: file, gitignored (dimmed)",
        190,
        (s) =>
          `<div class="col gap-2 fill">${projRow(["rail-row.tsx", 0, 0], s)}${projRow(["node_modules", 0, 1, { ignored: 1 }], s)}</div>`,
      ),
      group(
        "history row",
        250,
        (s) =>
          `<div class="col gap-2 fill">${hrow(data.history[0].title, data.history[0].when, s)}</div>`,
      ),
    ].join("");
  };
})();
