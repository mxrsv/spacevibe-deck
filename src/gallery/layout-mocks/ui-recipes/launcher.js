/* =====================================================================================
   launcher.js: state, scenes and interactions of the launcher tab (direction A, "Command bar").
   Ported from legacy-single-file.html onto tokens.css / chrome.css / window.Deck. Mock data for this
   tab only lives here. Hooks the regression scripts rely on: .a-wrap(.is-over) .a-proj [data-act=run]
   .tile[data-id] .pane .pane-tag .menu-list .is-hi #a-q #a-mq .row[data-id].
   URL: ?scene=return|two|first|working &pick=claude,codex &launched=1 &theme= &worst=
   ===================================================================================== */
(function () {
  "use strict";
  const D = window.Deck;
  const esc = D.esc;
  const params = new URLSearchParams(location.search);

  const SCENES = [
    { id: "return", name: "Return after quit" },
    { id: "two", name: "Two agents" },
    { id: "first", name: "First run" },
    { id: "working", name: "⌘T in a space" },
  ];
  const BAR_HITS = 5;
  const TILE_IDS = ["claude", "codex", "gemini", "opencode", "droid", "agy", "grok", "shell"]; // the launcher row: eight tiles, 1–4 pick the first four
  const tileAgents = () => TILE_IDS.map((id) => D.agent(id));
  const BASE = [
    { id: "board", name: "spacevibe-board", last: "claude" },
    { id: "deck", name: "spacevibe-deck", last: "codex" },
    { id: "academy", name: "spacevibe-academy", last: "claude" },
    { id: "active", name: "spacevibe-active", last: "codex" },
    { id: "cloud", name: "spacevibe-cloud", last: "claude" },
  ];
  const OLDER = [
    ["spacevibe-api", "2w"],
    ["spacevibe-bench", "2w"],
    ["spacevibe-hub", "3w"],
    ["spacevibe-giffcoffee", "3w"],
    ["tinysift", "4w"],
    ["kanban-vault", "1mo"],
    ["dotfiles", "1mo"],
    ["claude-skills", "1mo"],
    ["landing-experiments", "2mo"],
    ["notch-prototype", "2mo"],
    ["voice-mvp", "2mo"],
    ["kyantran", "3mo"],
    ["spacevibe-workspace", "3mo"],
    ["livestream-shorts", "4mo"],
    ["playground", "5mo"],
    ["deck-tauri-archive", "6mo"],
    ["spacevibe-board-worktrees", "6mo"],
    ["rust-notes", "7mo"],
  ];
  const WORST_NAMES = {
    board:
      "spacevibe-workspace-with-an-extremely-long-project-name-that-keeps-going-and-going-until-nothing-fits",
    deck: "数据分析平台-大数据可视化项目-第二期",
    academy: "🚀 launch-pad 🎯 growth 📦",
    active: "x",
    "spacevibe-api":
      "spacevibe_academy_internal_preview_environments_neon_branch_authentication_standard_protection_2026",
  };
  const WORST_TITLE =
    "Refactor the entire rail row component so long titles clamp to one line without shifting the mark";
  const WORST_BRANCH =
    "feature/DECK-12345-rail-refresh-with-an-unreasonably-long-branch-name-for-testing";
  const SEED = [
    {
      id: "b1",
      project: "board",
      agent: "claude",
      title: "Notch usage refresh",
      branch: "main",
      when: "yesterday",
    },
    {
      id: "b2",
      project: "board",
      agent: "codex",
      title: "Usage parser review",
      branch: "main",
      when: "yesterday",
    },
    {
      id: "b3",
      project: "board",
      agent: "claude",
      title: "Layout test",
      branch: "test",
      when: "16h",
      wt: true,
    },
    {
      id: "d1",
      project: "deck",
      agent: "codex",
      title: "Dock changes stack",
      branch: "main",
      when: "1h",
    },
    {
      id: "d2",
      project: "deck",
      agent: "claude",
      title: "Launcher flow mock",
      branch: "main",
      when: "1h",
    },
  ];
  const RESUMED = {
    b1: [
      "The refresh timer now pauses while the notch is hidden.",
      "Two files changed; the suite passes.",
    ],
    b2: [
      "Parser handles the 5h and weekly windows separately now.",
      "One open question left in the PR draft.",
    ],
    b3: ["Split view renders at 3 widths without clipping."],
    d1: ["Card headers fold on press; counts read neutral at zero."],
    d2: ["Three directions drafted; waiting on the owner's pick."],
  };

  /* ---------- data for the current Worst-case setting ---------- */
  let P = {};
  const build = () => {
    const w = D.worst();
    const mk = (p, ago) => ({
      ...p,
      name: (w && WORST_NAMES[p.id]) || p.name,
      branch: w && p.id === "board" ? WORST_BRANCH : "main",
      last: p.last || "claude",
      ago,
    });
    P = Object.fromEntries(
      [...BASE.map((p) => mk(p)), ...OLDER.map(([n, ago]) => mk({ id: n, name: n }, ago))].map(
        (p) => [p.id, p],
      ),
    );
  };
  const title = (it) => (D.worst() && it.id === "b1" ? WORST_TITLE : it.title);
  const AG = (id) => D.agent(id);

  /* ---------- state ---------- */
  let S = null;
  let seq = 0;
  let pendingLaunch = false;
  const base = (scene) => ({
    scene,
    items: scene === "first" ? [] : SEED,
    panes: null,
    panesProject: null,
    cmdT: false,
    menu: null,
    q: "",
    project: "board",
    sel: [],
    focusItem: null,
    running: [],
    projectIds: BASE.map((p) => p.id),
    mru: BASE.map((p) => p.id),
    mq: "",
    mi: 0,
  });
  const withDefaults = (s) => ({
    ...s,
    sel: [P[s.project].last],
    q: "",
    menu: null,
    mq: "",
    mi: 0,
  });
  const set = (patch) => {
    S = { ...S, ...patch };
    paint();
  };
  const byRecency = () => [...S.mru, ...Object.keys(P).filter((id) => !S.mru.includes(id))];
  const menuList = () => {
    const q = S.mq.trim().toLowerCase();
    return q ? byRecency().filter((id) => P[id].name.toLowerCase().includes(q)) : byRecency();
  };
  const liveIds = () => new Set([...S.running, ...(S.panes || []).map((p) => p.itemId)]);
  const proj = () => P[S.project];
  const over = () => Boolean(S.panes && S.cmdT);
  const launcherVisible = () => !S.panes || S.cmdT;
  const isFirst = () => S.items.length === 0 && S.scene === "first";

  function sceneState(scene) {
    let s = base(scene);
    if (scene === "working")
      s = {
        ...s,
        panes: [{ agent: "claude", itemId: "b1", resumed: true }],
        panesProject: "board",
        cmdT: true,
        focusItem: "b1",
        running: ["b1"],
      };
    const out = withDefaults(s);
    return scene === "two" ? { ...out, sel: ["claude", "codex"] } : out;
  }
  function startScene(scene) {
    S = sceneState(scene);
    paint();
  }
  function selectProject(id) {
    const mru = [id, ...S.mru.filter((x) => x !== id)];
    S = withDefaults({
      ...S,
      project: id,
      mru,
      projectIds: S.projectIds.includes(id) ? S.projectIds : [...S.projectIds, id],
      cmdT: Boolean(S.panes),
    });
    paint();
  }
  function launch(agents, pid = S.project) {
    const fresh = agents.map((agent) => ({
      id: "n" + ++seq,
      project: pid,
      agent,
      title: AG(agent).name,
      branch: P[pid].branch,
      when: "now",
      fresh: true,
    }));
    const sameSpace = over() && S.panesProject === pid;
    const panes = [
      ...(sameSpace ? S.panes : []),
      ...fresh.map((it) => ({ agent: it.agent, itemId: it.id, resumed: false })),
    ];
    S = withDefaults({
      ...S,
      items: [...fresh, ...S.items],
      panes,
      panesProject: pid,
      cmdT: false,
      project: pid,
      focusItem: fresh[0].id,
      running: [...S.running, ...fresh.map((it) => it.id)],
    });
    paint();
  }
  function resume(itemId) {
    const it = S.items.find((i) => i.id === itemId);
    if (S.panes && S.panes.some((p) => p.itemId === itemId)) {
      set({ cmdT: false, focusItem: itemId });
      return;
    }
    S = withDefaults({
      ...S,
      panes: [{ agent: it.agent, itemId, resumed: !it.fresh }],
      panesProject: it.project,
      project: it.project,
      cmdT: false,
      focusItem: itemId,
      running: S.running.includes(itemId) ? S.running : [...S.running, itemId],
    });
    paint();
  }
  const runCurrent = () => {
    if (launcherVisible() && !isFirst()) launch(S.sel.length ? S.sel : [proj().last]);
  };

  /* ---------- rail ---------- */
  const ib = (icon, label, attrs = "") => D.iconButton({ icon, label, attrs });
  function railHTML() {
    const live = liveIds();
    const groups = isFirst()
      ? D.empty({ icon: "folderAdd", text: "Projects you open land here" })
      : S.projectIds.map((id) => groupHTML(P[id], live)).join("");
    return `<div class="bar bar-band rel">${D.field({ icon: "search", placeholder: "Search", size: 28, cls: "grow" })}${ib("filter", "Filter")}${ib("plus", "Add project", `data-act="menu" data-id="rail" aria-haspopup="menu" aria-expanded="${S.menu === "rail"}"`)}
      ${S.menu === "rail" ? `<div class="z-menu a-rail-menu">${D.menu(D.menuItem({ icon: "folderOpen", label: "Open folder…", kbd: "⌘O", attrs: 'data-act="closemenu"' }) + D.menuItem({ icon: "download", label: "Clone repository…", attrs: 'data-act="closemenu"' }) + D.menuItem({ icon: "fork", label: "New worktree…", attrs: 'data-act="closemenu"' }))}</div>` : ""}</div>
      <div class="rail-list scroll">${groups}</div>
      ${D.railFoot()}`;
  }
  function groupHTML(p, live) {
    const items = S.items.filter((i) => i.project === p.id);
    const target = launcherVisible() && p.id === S.project;
    const row = (it) => {
      const on = live.has(it.id);
      return D.row({
        agent: it.agent,
        title: title(it),
        branch: it.branch,
        when: it.when,
        state: on ? "working" : "idle",
        live: on,
        forced: S.focusItem === it.id && S.panes && !S.cmdT ? "selected" : "",
        attrs: `data-act="item" data-id="${it.id}"`,
      });
    };
    const wt = items.filter((i) => i.wt);
    const head = D.groupHead({
      tag: "button",
      name: p.name,
      state: target ? "selected" : "",
      end: target ? `<span class="end flex">${D.icon("forward", 16, "ico-muted")}</span>` : "",
      attrs: `data-act="project" data-id="${p.id}" title="Open the launcher here"`,
    });
    return `<div class="grp">${head}
      ${items
        .filter((i) => !i.wt)
        .map(row)
        .join(
          "",
        )}${wt.length ? D.sectionHead("test", { icon: "branch" }) + wt.map(row).join("") : ""}</div>`;
  }

  /* ---------- stage ---------- */
  function paneHTML(pp, active) {
    const it = S.items.find((i) => i.id === pp.itemId);
    const p = P[it.project];
    const said = pp.resumed ? RESUMED[it.id] : [];
    return D.pane(
      { agent: pp.agent, title: title(it), project: p.name, said, state: "working" },
      { active, extra: pp.resumed ? D.badge("resumed", { icon: "undo", cls: "pane-tag" }) : "" },
    );
  }
  const panesHTML = (dim) =>
    `<div class="panes${dim ? " dim" : ""}">${S.panes.map((pp, i) => paneHTML(pp, !dim && i === S.panes.length - 1)).join("")}</div>`;
  function destHTML() {
    const p = proj();
    const beside = over() && S.panesProject === p.id;
    return `<span class="flex gap-6 t-meta">${D.icon(beside ? "split" : "plus", 12)}<span class="t-ellipsis">${beside ? "Beside" : "New space in"} <span class="t-strong t-muted">${esc(beside ? AG(S.panes[S.panes.length - 1].agent).name : p.name)}</span></span></span>`;
  }
  function tilesHTML(first) {
    const q = S.q.trim().toLowerCase();
    const agents = tileAgents().filter(
      (a) => !q || a.name.toLowerCase().includes(q) || a.cmd.includes(q),
    );
    return `<div class="a-tiles${first ? " is-disabled" : ""}">${agents
      .map((a) => {
        const on = S.sel.includes(a.id);
        return `<button class="tile" data-act="pick" data-id="${a.id}" aria-pressed="${on}" aria-label="${esc(a.name)}" title="${esc(a.name)}">${D.agentLogo(a.id, 16, { dim: !on })}<span class="tile-name">${esc(a.name)}</span></button>`;
      })
      .join("")}${D.kbd("⇧")}</div>`;
  }
  function projMenuHTML() {
    const q = S.mq.trim().toLowerCase();
    const list = menuList();
    const hl = (name) => {
      const at = q ? name.toLowerCase().indexOf(q) : -1;
      return at < 0
        ? esc(name)
        : `${esc(name.slice(0, at))}<span class="t-strong">${esc(name.slice(at, at + q.length))}</span>${esc(name.slice(at + q.length))}`;
    };
    const rows = list.length
      ? list
          .map((id, i) => {
            const x = P[id];
            const end = id === S.project ? D.icon("check", 12) : x.ago ? x.ago : "";
            return `<button class="menu-item${i === S.mi ? " is-hover is-hi" : ""}" role="menuitem" data-act="project" data-id="${id}">${D.avatar(x.name)}<span class="t-ellipsis">${hl(x.name)}</span>${end ? `<span class="menu-end">${end}</span>` : ""}</button>`;
          })
          .join("")
      : `<div class="menu-empty">No project matches</div>`;
    const field = `<label class="field sz-32 menu-search">${D.icon("search", 16)}<input id="a-mq" placeholder="Find in ${Object.keys(P).length} projects" value="${esc(S.mq)}" aria-label="Find a project" autocomplete="off"></label>`;
    return `<div class="z-menu a-menu">${D.menu(`${field}<div class="menu-list">${rows}</div>${D.sep()}<div class="menu-foot">${D.menuItem({ icon: "folderOpen", label: "Open folder…", kbd: "⌘O", attrs: 'data-act="closemenu"' })}${D.menuItem({ icon: "fork", label: "New worktree…", attrs: 'data-act="closemenu"' })}</div>`, { style: "width:var(--menu-w)" })}</div>`;
  }
  function launcherHTML() {
    const first = isFirst();
    const p = proj();
    const q = S.q.trim().toLowerCase();
    const hits = q
      ? byRecency()
          .filter((id) => P[id].name.toLowerCase().includes(q) && id !== p.id)
          .slice(0, BAR_HITS)
          .map((id) => P[id])
      : [];
    const bar = first
      ? `${D.button({ label: "Open folder", icon: "folderOpen", variant: "primary", size: 40, kbd: "⌘O", attrs: 'data-act="noop"' })}${D.button({ label: "Clone", icon: "download", size: 40, attrs: 'data-act="noop"' })}`
      : `<div class="cmdbar grow"><button class="btn btn-ghost sz-32 cmdbar-chip a-proj${S.menu === "proj" ? " is-selected" : ""}" data-act="menu" data-id="proj" aria-haspopup="menu" aria-expanded="${S.menu === "proj"}">${D.avatar(p.name)}<span class="t-ellipsis">${esc(p.name)}</span><span class="flex gap-4 t-meta t-faint a-branch">${D.icon("branch", 12)}<span class="t-ellipsis">${esc(p.branch)}</span></span>${D.icon("caretDown", 12, "ico-faint")}</button>
         <label class="cmdbar-input">${D.icon("search", 16)}<input id="a-q" placeholder="Filter agents or projects" value="${esc(S.q)}" aria-label="Filter agents or projects" autocomplete="off"></label>
         <span class="btn-split">${D.button({ label: S.sel.length > 1 ? `Run ${S.sel.length}` : "Run", variant: "primary", size: 32, kbd: "↵", attrs: 'data-act="run"' })}${D.button({ icon: "caretDown", variant: "primary", size: 32, attrs: 'aria-label="Launch profile" title="Launch profile: Default"' })}</span></div>
         ${S.menu === "proj" ? projMenuHTML() : ""}`;
    const list = hits.length
      ? D.menu(
          hits
            .map(
              (h, i) =>
                `<button class="menu-item${i === 0 ? " is-hover is-hi" : ""}" role="menuitem" data-act="project" data-id="${h.id}">${D.avatar(h.name)}<span class="t-ellipsis">${esc(h.name)}</span>${i === 0 ? D.kbd("↵") : h.ago ? `<span class="menu-end">${h.ago}</span>` : ""}</button>`,
            )
            .join(""),
          { cls: "a-hits", style: "width:100%" },
        )
      : "";
    return `<div class="a-wrap${over() ? " is-over panel" : ""}"><div class="a-bar">${bar}</div>${list}${tilesHTML(first)}${first ? "" : destHTML()}</div>`;
  }
  function stageHTML() {
    const showPanes = S.panes && !S.cmdT;
    const p = showPanes ? P[S.panesProject] : proj();
    const crumbs = isFirst()
      ? `<div class="crumbs"><span class="crumb">New project</span></div>`
      : `<div class="crumbs"><span class="crumb t-ellipsis">${esc(p.name)}</span>${D.icon("caretRight", 12, "ico-faint")}<span class="crumb t-ellipsis">${esc(proj().branch)}</span></div>`;
    const frame = `${crumbs}<span class="end flex gap-4">${D.ibSplit({ icon: "external", label: "Open in Cursor", caretLabel: "Choose which app opens a path" })}${ib("more", "More")}${ib("sidebarRight", "Show the side panel", 'aria-pressed="false"')}</span>`;
    return {
      frame,
      body: showPanes ? panesHTML(false) : (over() ? panesHTML(true) : "") + launcherHTML(),
    };
  }

  function view() {
    build();
    if (!S) {
      // first render: scene, pick and launched come from the URL
      S = sceneState(params.get("scene") || "return");
      if (params.get("pick")) S = { ...S, sel: params.get("pick").split(",") };
      pendingLaunch = Boolean(params.get("launched"));
    }
    const st = stageHTML();
    const scenes = `<nav class="gx-toggle" id="scenes" aria-label="Scenario">${SCENES.map((s) => `<button data-scene="${s.id}" aria-pressed="${S.scene === s.id}">${s.name}</button>`).join("")}</nav>`;
    return (
      scenes +
      D.windowShell({ rail: railHTML(), stageFrame: st.frame, stage: st.body, dockOpen: false })
    );
  }

  /* ---------- paint: write #app, restore the field the user was typing in ---------- */
  function paint() {
    const app = document.getElementById("app");
    const active = document.activeElement && document.activeElement.id;
    const entering = S.menuEnter;
    app.innerHTML = view();
    S = { ...S, menuEnter: false };
    D.fit();
    if (!entering)
      app.querySelectorAll(".menu").forEach((m) => {
        m.style.animation = "none";
      }); // the menu fades in once, not on every keystroke
    const keep = ["a-q", "a-mq"].includes(active) ? active : S.menu === "proj" ? "a-mq" : null;
    const hi = app.querySelector(".menu-list .is-hi");
    if (hi) hi.scrollIntoView({ block: "nearest" });
    const el = keep && document.getElementById(keep);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }

  /* ---------- events ---------- */
  function onClick(e) {
    const sc = e.target.closest("[data-scene]");
    if (sc) {
      startScene(sc.dataset.scene);
      return;
    }
    const el = e.target.closest("[data-act]");
    if (!el) {
      if (S.menu && !e.target.closest(".menu")) set({ menu: null });
      return;
    }
    const { act, id } = el.dataset;
    switch (act) {
      case "menu":
        set({ menu: S.menu === id ? null : id, mq: "", mi: 0, menuEnter: S.menu !== id });
        break;
      case "closemenu":
        set({ menu: null });
        break;
      case "project":
        selectProject(id);
        break;
      case "item":
        resume(id);
        break;
      case "pick": {
        const on = S.sel.includes(id);
        const sel = e.shiftKey ? (on ? S.sel.filter((x) => x !== id) : [...S.sel, id]) : [id];
        set({ sel: sel.length ? sel : [id] });
        break;
      }
      case "run":
        runCurrent();
        break;
      default:
        break;
    }
  }
  function onKey(e) {
    if (!S) return;
    const mod = e.metaKey || e.ctrlKey;
    const typing = document.activeElement && document.activeElement.tagName === "INPUT";
    const bare = !typing && !mod && !e.altKey;
    if (S.menu === "proj" && ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
      e.preventDefault();
      const list = menuList();
      if (e.key === "Enter") {
        if (list[S.mi]) selectProject(list[S.mi]);
        return;
      }
      set({
        mi: (S.mi + (e.key === "ArrowDown" ? 1 : -1) + list.length) % Math.max(1, list.length),
      });
      return;
    }
    // the browser keeps ⌘T for itself, so the mock also takes a bare t outside a text field
    if ((mod || bare) && e.key.toLowerCase() === "t") {
      e.preventDefault();
      if (S.panes) set({ cmdT: !S.cmdT });
      return;
    }
    if (e.key === "Escape") {
      if (S.menu) set({ menu: null });
      else if (S.q) set({ q: "" });
      else if (S.panes && S.cmdT) set({ cmdT: false });
      return;
    }
    // 1–4 pick the nth agent tile, ⇧ adds it (the browser keeps ⌘1–4)
    const digit = /^Digit([1-4])$/.exec(e.code);
    if (digit && (mod || bare || (e.shiftKey && !typing)) && launcherVisible() && !isFirst()) {
      e.preventDefault();
      const a = tileAgents()[Number(digit[1]) - 1];
      const on = S.sel.includes(a.id);
      set({
        sel: e.shiftKey
          ? on && S.sel.length > 1
            ? S.sel.filter((x) => x !== a.id)
            : on
              ? S.sel
              : [...S.sel, a.id]
          : [a.id],
      });
      return;
    }
    if (e.key === "Enter") {
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
      if (S.q) {
        const q = S.q.trim().toLowerCase();
        const ag = tileAgents().find((a) => a.name.toLowerCase().includes(q) || a.cmd.includes(q));
        if (ag) {
          launch([ag.id]);
          return;
        }
        const hit = byRecency().find(
          (id) => P[id].name.toLowerCase().includes(q) && id !== S.project,
        );
        if (hit) {
          selectProject(hit);
          return;
        }
      }
      runCurrent();
    }
  }

  D.mount(
    "launcher",
    () => view(),
    () => {
      if (pendingLaunch) {
        pendingLaunch = false;
        runCurrent();
      }
      if (!window.__launcherBound) {
        window.__launcherBound = true;
        document.addEventListener("click", onClick);
        document.addEventListener("keydown", onKey);
        document.addEventListener("input", (e) => {
          if (e.target.id === "a-q") set({ q: e.target.value });
          if (e.target.id === "a-mq") set({ mq: e.target.value, mi: 0 });
        });
      }
    },
  );
})();
