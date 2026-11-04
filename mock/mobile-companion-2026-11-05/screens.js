/* Screens for the iPhone direction mock. Three dealt structures (A lead, B, C) share the
   visual world; the shared row is common to all three. Everything renders from data.js. */
(function () {
  const EXTRA = {
    laptop:
      '<path d="M4 15.5V7.5C4 6.12 5.12 5 6.5 5h11C18.88 5 20 6.12 20 7.5v8"/><path d="M2.5 19h19"/><path d="M4 15.5h16l1.5 3.5h-19z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M8.5 20h7M12 16v4"/>',
    arrowUp: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    scan: '<path d="M3 8V6.5A3.5 3.5 0 0 1 6.5 3H8M16 3h1.5A3.5 3.5 0 0 1 21 6.5V8M21 16v1.5a3.5 3.5 0 0 1-3.5 3.5H16M8 21H6.5A3.5 3.5 0 0 1 3 17.5V16"/>',
    faceId:
      '<path d="M3 8V6.5A3.5 3.5 0 0 1 6.5 3H8M16 3h1.5A3.5 3.5 0 0 1 21 6.5V8M21 16v1.5a3.5 3.5 0 0 1-3.5 3.5H16M8 21H6.5A3.5 3.5 0 0 1 3 17.5V16"/><path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9 16c1.7 1.3 4.3 1.3 6 0"/>',
    flashlight:
      '<path d="M7 3h10v3.5l-2.5 3.5v9.5a2.5 2.5 0 0 1-5 0V10L7 6.5z"/><path d="M7 6.5h10M12 13v2.5"/>',
    wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5.2 12a10.5 10.5 0 0 1 13.6 0M8.6 15.4a5.6 5.6 0 0 1 6.8 0"/><path d="M12 19h.01"/>',
    camera:
      '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  };
  const svg = (paths, size, sw) =>
    `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const icon = (name, size = 24, sw) =>
    svg(EXTRA[name] || window.ICONS[name] || "", size, sw || (size >= 22 ? 1.8 : 2));
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /* ---------- building blocks ---------- */
  const statusBar = () =>
    `<div class="status"><span>9:41</span><span class="sig">${bars()}${icon("wifi", 17, 2.2)}<span class="bat"><i></i></span></span></div>`;
  const bars = () =>
    `<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg>`;
  const phone = (inner, cap) =>
    `<div class="phone-wrap"><div class="phone"><div class="island"></div>${inner}<div class="home-ind"></div></div><div class="gx-cap">${cap}</div></div>`;
  const logo = (D, p, size = 22) => {
    if (!p.agent)
      return `<span class="ico-box" style="width:${size}px;height:${size}px">${icon("terminal", size - 8, 2)}</span>`;
    const a = D.agents[p.agent];
    return `<img class="logo${a.mono ? " mono-logo" : ""}" src="${a.logo}" width="${size}" height="${size}" alt="">`;
  };
  const mark = (D, p) => `<span class="mk">${logo(D, p)}<i class="badge-st st-${p.st}"></i></span>`;
  const label = (D, p) => (p.agent ? D.agents[p.agent].name : p.shell);
  const tabbar = (items, cur) =>
    `<nav class="tabbar">${items
      .map(
        ([ic, name, badge]) =>
          `<button class="tab" aria-current="${name === cur}">${badge ? `<span class="dot tnum">${badge}</span>` : ""}${icon(ic, 26, 1.8)}<span>${name}</span></button>`,
      )
      .join("")}</nav>`;
  const stLabel = {
    needs: "Needs you",
    failed: "Failed",
    working: "Working",
    done: "Done",
    idle: "Idle",
  };

  const OLDER = [
    '<span class="ac">⏺</span> <span class="s">Bash</span>(git status --short)',
    '  <span class="mu">⎿  M electron/main.ts</span>',
    '  <span class="mu">   M src/lib/release-switches.ts</span>',
    '  <span class="mu">   ?? electron/relay/</span>',
    "",
    '<span class="ac">⏺</span> Three files touched so far. The pairing module is in, the',
    "  client is next. Plan for this step:",
    "",
    "  1. startRelay() opens one socket per pairing",
    "  2. frames are sealed with the pair key before they leave",
    "  3. nothing connects while mobileCompanion is off",
    "",
    '<span class="ac">⏺</span> <span class="s">Read</span>(electron/relay/pairing.ts)',
    '  <span class="mu">⎿  Read 112 lines</span>',
    "",
    '<span class="ac">⏺</span> <span class="s">Search</span>(pattern: "hooksSupported", path: "electron")',
    '  <span class="mu">⎿  Found 3 files</span>',
    "",
    '<span class="mu">  ⎿  Read electron/main.ts (412 lines)</span>',
    '<span class="mu">  ⎿  Read src/lib/release-switches.ts (31 lines)</span>',
    "",
  ];
  const term = (opts = {}) => {
    const lines = OLDER.concat(window.TERM.claudePrompt);
    const body = lines
      .map((l) => {
        const ask = l.startsWith("__ASK__");
        const txt = ask ? l.slice(7) : l;
        return ask && opts.moment
          ? `<span style="display:inline-block;background:var(--state-needs-you-bg);width:100%">${txt}</span>`
          : txt;
      })
      .join("\n");
    return `<div class="term" style="display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:12px">${opts.chip === false ? "" : `<span class="zoom-chip">${icon("expand", 12, 2)} 64 cols · 100%</span>`}<pre>${body}</pre></div>`;
  };
  const composer = (D, p, { live = false, gap = true } = {}) =>
    `<div class="composer${gap ? " home-gap" : ""}"><button class="cb${live ? " on" : ""}" aria-label="Live mode">${icon("keyboard", 20, 1.8)}</button><div class="field">Reply to ${esc(label(D, p))}</div><button class="send off" aria-label="Send">${icon("arrowUp", 18, 2.2)}</button></div>`;
  const accessory = () =>
    `<div class="keys"><span class="key live"><i style="width:7px;height:7px;border-radius:4px;background:currentColor;display:inline-block"></i>Live</span><span class="key">esc</span><span class="key">tab</span><span class="key">⇧tab</span><span class="key">⌃C</span><span class="key">${icon("caretLeft", 16, 2.2)}</span><span class="key">${icon("caretUp", 16, 2.2)}</span><span class="key">${icon("caretDown", 16, 2.2)}</span><span class="key">${icon("caretRight", 16, 2.2)}</span></div>`;
  const keyboard = () => {
    const row = (keys) => `<div class="kb-row">${keys}</div>`;
    const k = (s) =>
      s
        .split("")
        .map((c) => `<span class="k">${c}</span>`)
        .join("");
    return `<div class="keyboard">${row(k("qwertyuiop"))}${row(k("asdfghjkl"))}${row(`<span class="k alt">⇧</span>${k("zxcvbnm")}<span class="k alt">⌫</span>`)}${row(`<span class="k alt">123</span><span class="k space">space</span><span class="k ret">return</span>`)}</div>`;
  };
  const navBack = (back, title, sub, right = "more") =>
    `<div class="nav"><div class="nav-row"><button class="back">${icon("caretLeft", 22, 2.2)}<span class="ell">${back.length > 14 ? "Back" : esc(back)}</span></button><div class="grow"><div class="nav-title ell">${esc(title)}</div><div class="nav-sub ell">${esc(sub)}</div></div><button class="nb">${icon(right, 22)}</button></div></div>`;

  /* ---------- A · Since you left (timeline) ---------- */
  const A = {
    tabs: (D) =>
      tabbar(
        [
          ["clock", "Activity", D.needsCount],
          ["laptop", "Desktops"],
          ["settings", "Settings"],
        ],
        "Activity",
      ),
    home(D) {
      const said = {
        p1: 'Do you want to proceed?\n<span class="sel">❯ 1. Yes</span>   2. Always   3. No',
        p2: esc(D.question.slice(0, 44)) + "…",
        p3: '<span class="mu">✗</span> 4 tests failed · exit 1',
      };
      const items = D.panes
        .filter((p) => p.st !== "idle")
        .map(
          (p) => `<div class="tl-item${p.st === "needs" ? " needs" : ""}">
            <div class="tl-time tnum${p.when === "now" ? " now" : ""}">${p.when}</div>
            <div class="tl-rail"><i class="tl-stop st-${p.st}"></i></div>
            <div class="tl-body">
              <div class="tl-line">${logo(D, p, 18)}<span class="t ell">${label(D, p)} · ${stLabel[p.st]}</span></div>
              <div class="tl-where ell">${esc(p.project)} · ${esc(p.checkout)}</div>
              ${said[p.id] ? `<div class="tl-said">${said[p.id]}</div>` : `<div class="tl-where ell" style="color:var(--text-muted)">${esc(p.line)}</div>`}
            </div></div>`,
        )
        .join("");
      return `<div class="screen">${statusBar()}<div class="nav"><div class="nav-row"><span class="grow"></span><button class="nb">${icon("plus", 24)}</button></div><div class="large">Activity</div></div>
        <div class="content"><div class="tl">${items}</div></div>${A.tabs(D)}</div>`;
    },
    pane(D) {
      const p = D.panes[0];
      return `<div class="screen">${statusBar()}${navBack("Activity", label(D, p), `${p.project} · ${p.checkout}`)}<div class="content">${term({ moment: true })}</div>${composer(D, p)}</div>`;
    },
  };

  /* ---------- B · Needs you (queue) ---------- */
  const B = {
    tabs: (D) =>
      tabbar(
        [
          ["bell", "Needs you", D.needsCount],
          ["laptop", "Desktops"],
          ["settings", "Settings"],
        ],
        "Needs you",
      ),
    home(D) {
      const [p1, p2] = D.panes;
      const p3 = D.panes.find((p) => p.st === "failed");
      const head = (p, right) =>
        `<div class="w-head">${mark(D, p)}<div style="min-width:0"><div class="ell" style="font:var(--m-sub-strong)">${label(D, p)}</div><div class="ell" style="font:var(--m-foot);color:var(--text-faint)">${esc(p.project)} · ${esc(p.checkout)}</div></div><span style="font:var(--m-foot);color:var(--text-faint)">${right}</span></div>`;
      const working = D.panes.filter((p) => p.st === "working");
      const done = D.panes.filter((p) => p.st === "done");
      return `<div class="screen">${statusBar()}<div class="nav"><div class="nav-row"><span class="grow"></span><button class="nb">${icon("plus", 24)}</button></div><div class="large">Needs you <span class="count tnum">${D.needsCount}</span></div></div>
        <div class="content">
          <div class="waiting first">${head(p1, "now")}
            <div class="excerpt">Bash  npm test -- electron/relay/\nDo you want to proceed?\n<span class="sel">❯ 1. Yes</span>\n  2. Yes, and don’t ask again\n  3. No <span class="mu">(esc)</span></div>
            <div class="qa"><button class="primary"><span class="n">1</span>Yes</button><button><span class="n">2</span>Always</button><button><span class="n">3</span>No</button><button aria-label="Open pane">${icon("expand", 16, 2)}</button></div></div>
          <div class="waiting">${head(p2, "2m")}
            <div style="font:var(--m-sub);color:var(--text-muted)">${esc(D.question)}</div>
            <div style="display:flex;gap:8px"><div class="field" style="min-height:36px">Reply to Codex</div><button class="send off">${icon("arrowUp", 18, 2.2)}</button></div></div>
          <div class="waiting">${head(p3, "6m")}<div class="excerpt"><span class="mu">✗</span> relay › seals frames with the pair key\n<span class="mu">✗</span> relay › drops a frame that fails auth\nTests: 4 failed, 38 passed</div></div>
          <div class="grp-title"><span>Working</span><span class="tnum">${working.length}</span></div>
          <div class="grp">${working.map((p) => `<div class="row">${mark(D, p)}<div style="min-width:0"><div class="t ell">${label(D, p)}</div><div class="m ell">${esc(p.line)}</div></div><span class="chev">${icon("caretRight", 18, 2)}</span></div>`).join("")}
          <div class="row one"><span class="mk"><i class="badge-st st-done" style="position:static;box-shadow:none"></i></span><div class="t">${done.length} finished</div><span class="chev">${icon("caretRight", 18, 2)}</span></div></div>
        </div>${B.tabs(D)}</div>`;
    },
    pane(D, back = "Needs you") {
      const p = D.panes[0];
      return `<div class="screen">${statusBar()}${navBack(back, label(D, p), `${p.project} · ${p.checkout}`)}<div class="pager"><i class="on"></i><i></i><i></i></div><div class="content">${term({ moment: true })}</div>
        <div style="padding:10px 12px 4px;background:var(--m-bar-bg)"><div class="qa"><button class="primary"><span class="n">1</span>Yes</button><button><span class="n">2</span>Always</button><button><span class="n">3</span>No</button><button><span class="n">esc</span></button></div></div>${composer(D, p)}</div>`;
    },
  };

  /* ---------- C · One desktop (rail on the phone) ---------- */
  const C = {
    home(D) {
      const proj = D.projects[0].name;
      const mine = D.panes.filter((p) => p.project === proj);
      const byCheckout = {};
      mine.forEach((p) => (byCheckout[p.checkout] = byCheckout[p.checkout] || []).push(p));
      const groups = Object.entries(byCheckout)
        .map(
          ([
            co,
            ps,
          ]) => `<div class="grp-title" style="gap:12px;align-items:center"><span style="display:flex;gap:6px;align-items:center;flex:1;min-width:0">${icon("branch", 14, 2)}<span class="ell">${esc(co)}</span></span><button class="tint" aria-label="Changes">${icon("diff", 18, 2)}</button></div>
          <div class="grp">${ps.map((p) => `<div class="row${p.st === "needs" ? " needs" : ""}">${mark(D, p)}<div style="min-width:0"><div class="t ell">${label(D, p)}</div><div class="m ell">${esc(p.line)}</div></div><span class="r tnum">${p.when}</span></div>`).join("")}</div>`,
        )
        .join("");
      return `<div class="screen">${statusBar()}<div class="nav"><div class="nav-row"><span class="grow"></span><button class="nb">${icon("plus", 24)}</button><button class="nb">${icon("settings", 22)}</button></div>
          <div class="large"><span class="ell">${esc(D.desktop)}</span><span style="color:var(--text-faint);display:flex">${icon("caretDown", 22, 2.2)}</span></div></div>
        <div class="chips">${D.projects.map((p, i) => `<button class="chip" aria-pressed="${i === 0}"><span class="ell" style="max-width:180px">${esc(p.name)}</span>${p.needs ? `<span class="n tnum">${p.needs}</span>` : ""}</button>`).join("")}</div>
        <div class="content">${groups}</div><div style="height:34px"></div></div>`;
    },
    pane(D) {
      const p = D.panes[0];
      const tabs = D.panes.filter((x) => x.project === p.project && x.checkout === p.checkout);
      const dot = {
        needs: "var(--status-unread)",
        working: "var(--text-primary)",
        done: "var(--status-ok)",
        failed: "var(--status-failed)",
        idle: "var(--status-idle)",
      };
      return `<div class="screen">${statusBar()}${navBack(D.desktop, p.checkout, p.project, "diff")}
        <div class="ptabs">${tabs.map((x, i) => `<button class="ptab" aria-selected="${i === 0}">${logo(D, x, 16)}<span>${label(D, x)}</span><i class="dotm" style="background:${dot[x.st]}"></i></button>`).join("")}<button class="ptab" aria-label="New pane">${icon("plus", 16, 2)}</button></div>
        <div class="content">${term({ moment: false })}</div>${composer(D, p)}</div>`;
    },
  };

  /* ---------- D · All desktops (the spec's MOB5/MOB16 shape) ---------- */
  const pinned = (D) => {
    const waiting = D.panes.filter((p) => p.st === "needs" || p.st === "failed").slice(0, 3);
    const body = {
      p1: '<div class="excerpt" style="padding:6px 10px">Do you want to proceed?  <span class="sel">❯ 1. Yes</span></div><div class="qa"><button class="primary"><span class="n">1</span>Yes</button><button><span class="n">2</span>Always</button><button><span class="n">3</span>No</button></div>',
      p2: `<div style="font:var(--m-sub);color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(D.question)}</div><div class="qa"><button class="primary">${icon("reply", 16, 2)}Reply</button></div>`,
      p3: '<div class="excerpt" style="padding:6px 10px"><span class="mu">✗</span> Tests: 4 failed, 38 passed</div>',
    };
    const item = (p) =>
      `<div class="waiting" style="gap:8px;padding:12px;margin-bottom:8px">${`<div class="w-head">${mark(D, p)}<div style="min-width:0"><div class="ell" style="font:var(--m-sub-strong)">${label(D, p)}</div><div class="ell" style="font:var(--m-foot);color:var(--text-faint)">${esc(p.project)} · ${esc(p.checkout)}</div></div><span style="font:var(--m-foot);color:var(--text-faint)">${p.when}</span></div>`}${body[p.id] || `<div class="excerpt" style="padding:6px 10px">${esc(p.line)}</div>`}</div>`;
    return `<div class="grp-title" style="color:var(--status-unread)"><span style="font:var(--m-caption-strong)">Needs you · ${D.needsCount}</span>${D.needsCount > waiting.length ? `<span>See all</span>` : ""}</div>${waiting.map(item).join("")}`;
  };
  const T = {
    home(D, pin = false) {
      const [on, off] = D.desktops;
      const projects = [...new Set(D.panes.map((p) => p.project))];
      const body = projects
        .map((pr) => {
          const ps = D.panes.filter((p) => p.project === pr);
          const cos = [...new Set(ps.map((p) => p.checkout))];
          return `<div class="grp-title"><span class="ell" style="font:var(--m-sub-strong);color:var(--text-muted)">${esc(pr)}</span></div><div class="grp">${cos
            .map(
              (co) =>
                `<div style="display:flex;gap:6px;align-items:center;padding:10px 14px 2px;font:var(--m-foot);color:var(--text-faint)">${icon("branch", 13, 2)}<span class="ell">${esc(co)}</span></div>${ps
                  .filter((p) => p.checkout === co)
                  .map(
                    (p) =>
                      `<div class="row${p.st === "needs" ? " needs" : ""}">${mark(D, p)}<div style="min-width:0"><div class="t ell">${label(D, p)}</div><div class="m ell">${esc(p.line)}</div></div><span class="r tnum">${p.when}</span></div>`,
                  )
                  .join("")}`,
            )
            .join("")}</div>`;
        })
        .join("");
      const dHead = (d) =>
        `<div style="display:flex;align-items:center;gap:8px;padding:6px calc(var(--m-pad) + 4px) 0;font:var(--m-headline)">${icon(d.os === "macOS" ? "laptop" : "monitor", 20)}<span class="ell" style="flex:1">${esc(d.name)}</span><span style="display:flex;align-items:center;gap:6px;font:var(--m-foot);color:var(--text-faint)"><i class="online${d.online ? "" : " off"}"></i>${d.online ? esc(d.path) : "offline · " + esc(d.seen)}</span></div>`;
      return `<div class="screen">${statusBar()}<div class="nav"><div class="nav-row"><span class="grow"></span><button class="nb">${icon("plus", 24)}</button></div><div class="large">Desktops</div></div>
        <div class="content">${pin ? pinned(D) : ""}${dHead(on)}${body}<div style="height:16px"></div>${dHead(off)}</div>${tabbar(
          [
            ["laptop", "Desktops", D.needsCount],
            ["settings", "Settings"],
          ],
          "Desktops",
        )}</div>`;
    },
    pane(D) {
      const p = D.panes[0];
      return `<div class="screen">${statusBar()}${navBack("Desktops", label(D, p), `${p.project} · ${p.checkout}`)}<div class="content">${term({ moment: false })}</div>${composer(D, p)}</div>`;
    },
  };

  const E = { home: (D) => T.home(D, true), pane: (D) => B.pane(D, "Desktops") };

  const live = (D, dir) => {
    const p = D.panes[0];
    const back = { A: "Activity", B: "Needs you", C: D.desktop, D: "Desktops", E: "Desktops" }[dir];
    const extra =
      dir === "B" || dir === "E" ? '<div class="pager"><i class="on"></i><i></i><i></i></div>' : "";
    return `<div class="screen">${statusBar()}${navBack(back, label(D, p), `${p.project} · ${p.checkout}`, "keyboard")}${extra}<div class="content">${term({ chip: false })}</div>${accessory()}${keyboard()}<div style="height:30px;background:var(--m-kb-bg)"></div></div>`;
  };

  /* ---------- shared screens ---------- */
  const qr = () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const n = 25,
      cell = 6.4;
    let r = "";
    const finder = (x, y) =>
      `<rect x="${x * cell}" y="${y * cell}" width="${7 * cell}" height="${7 * cell}" fill="#111"/><rect x="${(x + 1) * cell}" y="${(y + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#f2f2f2"/><rect x="${(x + 2) * cell}" y="${(y + 2) * cell}" width="${3 * cell}" height="${3 * cell}" fill="#111"/>`;
    const inFinder = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (!inFinder(x, y) && rnd() > 0.52)
          r += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="#111"/>`;
    return `<svg viewBox="0 0 ${n * cell} ${n * cell}" width="100%" height="100%">${r}${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
  };
  const S = {
    pair(D) {
      return `<div class="cam"><div class="screen">${statusBar()}<div class="nav"><div class="nav-row" style="padding:0 8px"><button class="nb" aria-label="Close">${icon("close", 20, 2.2)}</button><span class="grow"></span><button class="nb" aria-label="Torch">${icon("flashlight", 20)}</button></div></div></div>
        <div class="reticle"><svg class="frame" viewBox="0 0 248 248" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><path d="M4 52V24A20 20 0 0 1 24 4h28M196 4h28a20 20 0 0 1 20 20v28M244 196v28a20 20 0 0 1-20 20h-28M52 244H24A20 20 0 0 1 4 224v-28"/></svg><div class="qr">${qr()}</div></div>
        <div class="cam-copy"><div class="h">Scan the code in Deck</div><div class="s">Settings → Mobile → Pair a phone</div><div class="e2e">${icon("lock", 14, 2)}End-to-end encrypted, no account</div></div>
        <div class="found"><span class="ico-box" style="width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,.1);color:#fff">${icon("laptop", 22)}</span><div style="min-width:0"><div class="t ell">${esc(D.desktop)}</div><div class="m">macOS · code matches</div></div><button class="go">Pair</button></div></div>`;
    },
    lock(D) {
      return `<div class="lock"></div><div class="screen" style="z-index:1">${statusBar()}<div style="display:flex;justify-content:center;color:var(--text-muted);margin-top:4px">${icon("lock", 18, 2)}</div><div class="lock-date">Thursday 5 November</div><div class="lock-time tnum">9:41</div></div>
        <div class="notes" style="z-index:2">
          <div class="note"><span class="app-ic"><img src="assets/deck-icon.svg" alt=""></span><div style="min-width:0"><div class="h"><span class="ell">${esc(D.deck)}</span><span>now</span></div><div class="b">Claude Code needs attention</div></div></div>
          <div class="note"><span class="app-ic"><img src="assets/deck-icon.svg" alt=""></span><div style="min-width:0"><div class="h"><span class="ell">${esc(D.api)}</span><span>2m ago</span></div><div class="b">Codex needs attention</div></div></div>
          <div class="note"><span class="app-ic"><img src="assets/deck-icon.svg" alt=""></span><div style="min-width:0"><div class="h"><span class="ell">${esc(D.deck)}</span><span>14m ago</span></div><div class="b">Claude Code finished</div></div></div>
        </div>
        <div class="lock-bottom" style="z-index:2"><i>${icon("flashlight", 22)}</i><i>${icon("camera", 22)}</i></div>`;
    },
    newAgent(D) {
      const picked = (i) => `aria-pressed="${i === 0}"`;
      const agents = ["claude", "codex", "opencode"];
      return `<div class="behind">${C.home(D)}</div><div class="dim"></div>
        <div class="sheet"><div class="grabber"></div><div class="nav-row"><button class="back" style="padding-left:8px">Cancel</button><div class="grow nav-title">New agent</div><span style="width:72px"></span></div>
          <div class="lbl">Project</div>
          <div class="grp">${[
            [D.deck, "main", true],
            [D.deck, D.relay, false],
            [D.api, "main", false],
          ]
            .map(
              ([pr, co, on]) =>
                `<div class="row one" style="grid-template-columns:22px minmax(0,1fr)"><span class="radio${on ? " on" : ""}">${on ? icon("check", 14, 2.6) : ""}</span><div style="min-width:0"><div class="t ell">${esc(pr)}</div><div class="m ell">${icon("branch", 12, 2)}${esc(co)}</div></div></div>`,
            )
            .join("")}</div>
          <div class="lbl">Agent</div>
          <div class="agents">${agents.map((a, i) => `<button class="agent-pick" ${picked(i)}>${logo(D, { agent: a })}<span>${D.agents[a].name}</span></button>`).join("")}</div>
          <div class="lbl">Prompt</div>
          <div class="area">Review the relay pairing tests and tell me which cases are missing</div>
          <button class="big-btn">${icon("play", 18, 2)}Open agent</button></div>`;
    },
    changes(D) {
      const rows = D.changes
        .map(
          (c) =>
            `<div class="ch-row"><span class="ch-st ${c.st}">${c.st}</span><div style="min-width:0"><div class="ell" style="font:var(--m-sub-strong)">${esc(c.name)}</div><div class="ell" style="font:var(--m-foot);color:var(--text-faint)">${esc(c.dir)}</div></div><span class="tnum" style="font:var(--m-foot)">${c.add ? `<span class="plus">+${c.add.toLocaleString("en")}</span>` : ""} ${c.del ? `<span class="minus">−${c.del.toLocaleString("en")}</span>` : ""}</span></div>`,
        )
        .join("");
      return `<div class="screen">${statusBar()}${navBack("Back", D.relay, D.deck, "refresh")}
        <div class="seg"><button>Files</button><button aria-pressed="true">Changes <span class="tnum">${D.changes.length}</span></button><button>Usage</button></div>
        <div class="content"><div class="grp">${rows}</div>
          <div class="diff"><div class="h">@@ electron/relay/client.ts  12,6 +12,10 @@</div><div class="a">+export function startRelay(config: RelayConfig) {</div><div class="a">+  if (!config.enabled) return null;</div><div class="d">-  return connectStub(config.url);</div><div class="a">+  return sealChannel(openSocket(config.url), config.keys);</div><div>   }</div></div></div><div style="height:34px"></div></div>`;
    },
    settings(D) {
      const dRow = (d) =>
        `<div class="row"><span class="ico-box">${icon(d.os === "macOS" ? "laptop" : "monitor", 18)}</span><div style="min-width:0"><div class="t ell">${esc(d.name)}</div><div class="m ell"><i class="online${d.online ? "" : " off"}"></i>${d.online ? `${d.os} · ${esc(d.path)}` : `${d.os} · offline · seen ${esc(d.seen)}`}</div></div><span class="chev">${icon("caretRight", 18, 2)}</span></div>`;
      const sRow = (ic, t, on) =>
        `<div class="row one"><span class="ico-box">${icon(ic, 18)}</span><div class="t">${t}</div><span class="switch${on ? " on" : ""}"></span></div>`;
      return `<div class="screen">${statusBar()}<div class="nav"><div class="nav-row"></div><div class="large">Settings</div></div>
        <div class="content"><div class="grp-title"><span>Desktops</span></div><div class="grp">${D.desktops.map(dRow).join("")}<div class="row one"><span class="ico-box tint">${icon("scan", 18)}</span><div class="t tint">Pair a desktop</div><span></span></div></div>
          <div class="grp-title"><span>This phone</span></div><div class="grp">${sRow("faceId", "Unlock with Face ID", true)}${sRow("bell", "Notifications", true)}</div>
          <div class="grp-title"><span>Version 1.0 (12) · protocol 1</span></div></div><div style="height:34px"></div></div>`;
    },
  };

  /* ---------- render ---------- */
  const DIRS = [
    {
      key: "D",
      title: "All desktops, as the spec reads",
      lede: "<b>Home is the tree the spec describes</b> (MOB5, MOB16): every paired desktop, then projects, checkouts and panes, with the rail’s marks; an offline desktop sits at the end with its last-seen time. The baseline the others are measured against.",
      build: T,
    },
    {
      key: "E",
      title: "All desktops, with Needs you pinned",
      lede: "<b>D’s full tree with B’s answers pinned on top.</b> The waiting agents sit first and take 1 / 2 / 3 or a reply in place; the whole tree follows, every row with its last line and age. <b>Why:</b> if Deck misses a needs-you (no hooks on Windows, a trust dialog that reads idle, a prompt the heuristic calls finished), that pane is still on Home and reads as stuck. Keeps MOB16 and adds to it.",
      build: E,
    },
    {
      key: "A",
      title: "Since you left",
      lede: "<b>Home is a timeline</b> of what every agent did while you were away, newest first: asked, failed, finished, still working. <b>Signature:</b> each stop on the rail opens the pane scrolled to that exact moment, highlighted. The tree moves to the Desktops tab, so MOB16 would change.",
      build: A,
    },
    {
      key: "B",
      title: "Needs you",
      lede: "<b>Home is a queue</b> of only the agents waiting on you, each with the lines it stopped on. <b>Signature:</b> answer from the queue itself (1 / 2 / 3, or a typed reply) without opening the pane; inside a pane, the pager moves to the next waiting agent. The tree moves to the Desktops tab, so MOB16 would change.",
      build: B,
    },
    {
      key: "C",
      title: "One desktop",
      lede: "<b>Home is Deck’s rail on the phone:</b> one desktop at a time (switch in the title), its projects as chips, checkouts and panes in the same order and marks as the desktop. <b>Signature:</b> the pane opens with the checkout’s tabs across the top, like the stage. One desktop at a time changes MOB5.",
      build: C,
    },
  ];
  window.renderMock = function () {
    const D = window.buildData(document.documentElement.dataset.worst === "1");
    const out = DIRS.map(
      (
        d,
      ) => `<section class="gx-section"><div class="gx-head"><h2>${d.key} · ${d.title}</h2></div><p class="gx-lede">${d.lede}</p>
        <div class="gx-row">${phone(d.build.home(D), "Home")}${phone(d.build.pane(D), "Pane · reply")}${phone(live(D, d.key), "Pane · Live mode")}</div></section>`,
    ).join("");
    const shared = `<section class="gx-section"><div class="gx-head"><h2>Shared by every direction</h2></div><p class="gx-lede">Pairing, push, new agent, a checkout’s changes and settings look the same whichever home wins; only where they open from changes.</p>
      <div class="gx-row">${phone(S.pair(D), "Pair")}${phone(S.lock(D), "Push")}${phone(S.newAgent(D), "New agent")}${phone(S.changes(D), "Checkout · Changes")}${phone(S.settings(D), "Settings")}</div></section>`;
    document.getElementById("mock").innerHTML = out + shared;
  };
})();
