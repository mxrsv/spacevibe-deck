/* =====================================================================================
   rail.js: Rail tab helpers. Mock data tweaks and render helpers for rail.html only.
   Everything here is built from chrome.css recipes and Deck helpers; no style of its own.
   Global: window.RailMock { column(data, {narrow}), sheet() }
   ===================================================================================== */
(function () {
  "use strict";
  const D = window.Deck;
  const { icon, esc } = D;
  const ST = {
    hover: "is-hover",
    focus: "is-focus",
    selected: "is-selected",
    pressed: "is-pressed",
    disabled: "is-disabled",
    dragover: "is-dragover",
    needs: "is-needs",
  };
  const st = (s) =>
    s
      ? s
          .split(" ")
          .map((x) => ST[x] || x)
          .join(" ")
      : "";
  const RANK = { failed: 5, needs: 4, unread: 3, working: 2, idle: 1 };
  const SELECTED_ROW = "d2";
  const FOLDED = (i) => i === 3 || i === 6;
  const mk = (id, agent, title, branch, state, when, live = true) => ({
    id,
    agent,
    title,
    branch,
    state,
    when,
    live,
  });

  /* ---------- data: the shared set, plus a fourth project in the normal set ---------- */
  function projects(data) {
    if (D.worst()) return data.projects;
    const [deck, api, board] = data.projects; // the list must fit the 800 high column at rest: one remembered row per case
    const slim = { ...board, rows: board.rows.slice(0, 1) };
    const withLive = {
      ...deck,
      rows: deck.rows.filter((r) => r.id !== "d4"),
      checkouts: deck.checkouts.map((c) => ({
        ...c,
        rows: [mk("d6", "claude", "Mark ring spacing", "rail-marks", "unread", "12m")],
      })),
    };
    const academy = {
      id: "academy",
      name: "spacevibe-academy",
      branch: "main",
      changes: 3,
      checkouts: [],
      rows: [
        mk("c1", "claude", "Payload auth flow", "main", "failed", "now"),
        mk("c2", "codex", "Seed script", "main", "working", "now"),
        mk("c3", "claude", "Lesson player spec", "main", "idle", "2d", false),
      ],
    };
    return [withLive, api, slim, academy];
  }
  const loudest = (p) =>
    p.rows
      .filter((r) => r.live)
      .reduce((best, r) => ((RANK[r.state] || 0) > (RANK[best] || 0) ? r.state : best), "");
  const countOf = (p) => (D.worst() ? p.changes : p.rows.length);

  /* ---------- pieces: every row and header comes from Deck.row / Deck.groupHead ---------- */
  const message = (r, data) => {
    const ask = (data.attention.find((a) => a.title === r.title) || {}).ask;
    if ((r.state === "needs" || r.state === "failed") && ask)
      return `${icon(r.state === "failed" ? "alertCircle" : "message", 12)}<span class="t-ellipsis">${esc(ask)}</span>`;
    if (r.state === "unread" && r.live)
      return `${icon("checkCircle", 12)}<span class="t-ellipsis">Finished</span>`;
    return "";
  };
  const agentRow = (r, data, o = {}) =>
    D.row({
      agent: r.agent,
      title: r.title,
      branch: r.branch,
      meta: o.meta ?? message(r, data),
      when: r.when,
      state: r.state,
      live: r.live,
      forced: o.state,
      checkout: o.checkout,
      actions: o.actions ?? (r.live ? D.rowAction("more", "More") : D.rowAction("close", "Forget")),
      cls: o.cls,
    });
  // DL-27.28: a checkout line is a label, the branch and its worktree tag; it ends without a "+"
  const checkoutLine = (c, state) =>
    D.row({ size: 32, icon: "fork", title: c.branch, forced: state, cls: "row-checkout t-muted" });

  // A project header. Open: "+" and more overlay the end on hover. Folded: loudest mark and count, which step aside for the actions on hover or focus.
  const projHead = (p, o = {}) => {
    const { folded = false, state = "", count = 0, rollup = "" } = o;
    return D.groupHead({
      name: p.name,
      open: !folded,
      state,
      count: folded ? count : null,
      rollup: folded ? rollup : "",
      actions: D.rowAction("plus", "New agent") + D.rowAction("more", "More"),
    });
  };
  const project = (p, data, i) => {
    const folded = FOLDED(i);
    if (folded)
      return `<section class="grp">${projHead(p, { folded, count: countOf(p), rollup: loudest(p) })}</section>`;
    const row = (r, o) =>
      agentRow(r, data, { ...o, state: r.id === SELECTED_ROW ? "selected" : "" });
    const live = p.rows.filter((r) => r.live),
      kept = p.rows.filter((r) => !r.live);
    const checkouts = p.checkouts
      .map(
        (c) =>
          checkoutLine(c) +
          [...c.rows.filter((r) => r.live), ...c.rows.filter((r) => !r.live)]
            .map((r) => row(r, { checkout: true }))
            .join(""),
      )
      .join("");
    return `<section class="grp">${projHead(p)}${live.map((r) => row(r)).join("")}${kept.map((r) => row(r)).join("")}${checkouts}</section>`;
  };
  const disc = (label, count, open, state) =>
    `<button class="row row-24 ${st(state)}" aria-expanded="${open}">${icon(open ? "caretDown" : "caretRight", 12)}<span class="row-title grow t-meta">${esc(label)}</span><span class="t-meta">${esc(count)}</span></button>`;
  const hiddenRow = (name, state) =>
    `<div class="row row-24 ${st(state)}"><span class="row-title grow t-faint">${esc(name)}</span>${D.chip({ label: "Show", size: 20 })}</div>`;
  const archived = (data) =>
    data.archived
      .slice(0, D.worst() ? 99 : 1)
      .map((a) =>
        D.row({
          agent: a.agent,
          title: a.title,
          meta: `${icon("folder", 12)}<span class="t-ellipsis">${esc(a.project)}</span>`,
          when: a.when,
          live: false,
        }),
      )
      .join("");

  const controls = (data) => {
    const n = D.worst() ? "99+" : data.attention.length; // the pill caps at 99+
    const chip = `<button class="chip chip-need" aria-label="${n} agents need you">${D.mark("needs")}<span>${n}</span></button>`;
    return `<div class="bar">${D.field({ icon: "search", placeholder: "Search", size: 28, cls: "grow" })}${chip}${D.iconButton({ icon: "filter", label: "Organize" })}${D.iconButton({ icon: "plus", label: "Add project" })}</div>`;
  };

  /* ---------- the full column ---------- */
  function column(data, { narrow = false } = {}) {
    const ps = projects(data);
    const hiddenCount = D.worst() ? data.moreProjects.length : 3;
    return `<aside class="win-rail rs-rail${narrow ? " is-narrow" : ""}" aria-label="Rail">${D.railFrame()}${controls(data)}
      <div class="rail-list">${ps.map((p, i) => project(p, data, i)).join("")}
        <section class="grp">${disc("Archived", D.worst() ? 9999 : 2, true)}${archived(data)}</section>
        <section class="grp">${disc("Hidden", hiddenCount, false)}</section></div>
      ${D.railFoot()}</aside>`;
  }

  /* ---------- the states sheet ---------- */
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
  const bed = (inner) => `<div class="win-rail pad-8 col gap-2 rs-bed">${inner}</div>`;
  const cell = (cap, inner) =>
    `<div class="gx-cell"><span class="gx-cap">${cap}</span>${inner}</div>`;
  const piece = (title, cells) =>
    `<section><h3 class="gx-h">${title}</h3><div class="rs-grid">${cells}</div></section>`;
  const matrix = (title, make, na = []) =>
    piece(
      title,
      STATES.map(([cap, s]) =>
        cell(cap, na.includes(cap) ? `<span class="gx-cap">n/a</span>` : bed(make(s))),
      ).join(""),
    );

  function sheet(data) {
    const p = projects(data)[0],
      academy = projects(data).find((x, i) => FOLDED(i)) || p;
    const live = p.rows.find((r) => r.state === "needs") || p.rows[0];
    const rem = p.rows.find((r) => !r.live) || p.rows[p.rows.length - 1];
    const idle = { ...live, state: "idle", live: true };
    const co = p.checkouts[0] || { branch: "rail-marks", rows: [] };
    const coRow = co.rows[0] || rem;
    const statuses = [
      ["needs", "Which radius should win?"],
      ["working", ""],
      ["failed", "Tests failed: 2"],
      ["unread", "Finished"],
      ["idle", ""],
      ["ended", "Ended"],
    ]
      .map(([s, m]) =>
        cell(
          s,
          bed(
            D.row({
              agent: "claude",
              title: "Launcher flow mock",
              branch: "main",
              state: s,
              meta: m
                ? `${icon(s === "failed" ? "alertCircle" : s === "unread" ? "checkCircle" : s === "needs" ? "message" : "info", 12)}<span class="t-ellipsis">${m}</span>`
                : "",
              actions: D.rowAction("more", "More"),
            }),
          ),
        ),
      )
      .join("");
    const editing = (state, value, error) =>
      bed(
        `<div class="row row-44 is-selected"><span class="row-lead">${D.mark("needs")}</span><span class="row-logo">${D.agentLogo("claude", 16)}</span>${D.field({ size: 28, value, placeholder: "Session name", state, error, cls: "grow" })}</div>`,
      );
    const rename = [
      ["editing", "focus", "Launcher flow mock"],
      ["empty, placeholder", "focus", ""],
      ["hover", "hover", "Launcher flow mock"],
      ["too long, error", "", "Launcher flow mock with a name that runs far past the limit", true],
    ]
      .map(([cap, s, v, err]) => cell(cap, editing(s, v, err)))
      .join("");
    return [
      matrix("project header", (s) => projHead(p, { state: s })),
      matrix("project header, collapsed", (s) =>
        projHead(academy, {
          folded: true,
          state: s,
          count: countOf(academy),
          rollup: loudest(academy) || "failed",
        }),
      ),
      matrix("agent row", (s) => agentRow(idle, data, { state: s })),
      piece("agent row, status", statuses),
      matrix("remembered row", (s) => agentRow(rem, data, { state: s })),
      matrix(
        "checkout row",
        (s) => checkoutLine(co, s) + agentRow(coRow, data, { checkout: true, state: s }),
      ),
      matrix(
        "archived and hidden",
        (s) => disc("Archived", 2, false, s) + hiddenRow(data.moreProjects[0].name, s),
      ),
      matrix("footer buttons", (s) => D.railFoot({ state: s })),
      matrix(
        "search field",
        (s) =>
          `<div class="bar">${D.field({ icon: "search", placeholder: "Search", size: 28, state: s, cls: "grow" })}</div>`,
        ["selected", "selected + focus", "pressed", "drag-over"],
      ),
      piece("inline rename field", rename),
    ].join("");
  }

  window.RailMock = { column, sheet };
})();
