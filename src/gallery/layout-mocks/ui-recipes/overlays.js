/* =====================================================================================
   overlays.js: Overlays tab, part 1 of 3 (menus, popovers, tooltips) + shared page helpers.
   Parts 2 and 3: overlays-modals.js, overlays-forms.js. Every function returns an HTML string
   and uses only chrome.css recipes through window.Deck. Mock data and copy mirror the real components:
   project-rail-row-actions.tsx, worktree-card-menus.tsx, dock-changes-file-menu.tsx,
   command-bar-project-menu.tsx, command-bar-profile-menu.tsx, attention-popover.tsx,
   dev-servers-popover.tsx, prompt-popover.tsx, controls/tooltip.tsx, action-tooltip.tsx.
   ===================================================================================== */
(function () {
  "use strict";
  const D = window.Deck;
  const OV = (window.OV = window.OV || {});
  const { esc } = D;
  const caret = D.icon("caretRight", 12);

  /* ---------- shared layout helpers (review chrome only) ---------- */
  OV.cap = (t) => `<span class="gx-cap">${esc(t)}</span>`;
  OV.cell = (cap, html, cls = "") =>
    `<div class="gx-cell ${cls}">${cap ? OV.cap(cap) : ""}${html}</div>`;
  OV.sec = (title, body) => `<section><h3 class="gx-h">${title}</h3>${body}</section>`;
  OV.grid = (cells, col = "calc(var(--menu-w) + var(--space-16))") =>
    `<div class="gx-grid" style="--gx-col:${col}">${cells}</div>`;
  // The dimmed mini window behind a floating surface (Deck.backdrop): modal beds add the scrim and centre the surface.
  OV.bed = (inner, { rows = 7, scrim = true, cls = "" } = {}) =>
    D.backdrop(inner, { rows, scrim, cls });
  // Long strings for the Worst case toggle.
  OV.long = (n) =>
    [
      "spacevibe-workspace-with-an-extremely-long-project-name-that-keeps-going-and-going-until-nothing-fits",
      "数据分析平台-大数据可视化项目-第二期",
      "🚀 launch-pad 🎯 growth 📦",
      "x",
    ][n % 4];

  /* ---------- menus (--elev-1) ---------- */
  const item = (o) => D.menuItem(o);
  const menu = (...parts) => D.menu(parts.join(""));
  const label = (t) => `<div class="menu-label">${esc(t)}</div>`;

  const railMenu = (w, sub) =>
    menu(
      item({ icon: "edit", label: "Rename" }),
      item({ icon: "pin", label: "Pin" }),
      D.gap(),
      item({ icon: "copy", label: "Copy path", state: sub ? "" : "hover" }),
      item({ icon: "branch", label: "Copy branch", state: "disabled" }),
      item({
        icon: "folderOpen",
        label: w ? "Open in Visual Studio Code – Insiders (Remote Tunnels)" : "Open in Finder",
      }),
      item({ icon: "plus", label: "New here", end: caret, state: sub ? "hover" : "" }),
      D.gap(),
      item({ icon: "archive", label: "Archive" }),
      item({ icon: "close", label: "Close", danger: true }),
    );
  const railSub = () =>
    menu(
      item({ icon: "plus", label: "New agent…" }),
      item({ icon: "fork", label: "New worktree…" }),
      item({ icon: "terminal", label: "Open shell" }),
    );

  const checkoutMenu = (w, mode) =>
    menu(
      mode === "pending"
        ? `<div class="menu-empty">${D.icon("loader", 12, "spin")}&nbsp;Looking for installed agents…</div>`
        : mode === "none"
          ? `<div class="menu-empty">No quick agents available</div>`
          : item({ icon: "plus", label: w ? "New agent…" + " for " + OV.long(0) : "New agent…" }),
      D.gap(),
      item({ icon: "terminal", label: "Open shell" }),
      item({ icon: "split", label: "New split here", state: mode === "rest" ? "hover" : "" }),
      item({ icon: "folderOpen", label: "Open in Finder" }),
      mode === "rest" ? item({ icon: "folder", label: "Open another project…" }) : "",
    );

  const dockMenu = (w, deleted) =>
    deleted
      ? menu(item({ icon: "copy", label: "Copy path" }))
      : menu(
          item({ label: "Open", state: "hover" }),
          item({ label: "Reveal in Finder" }),
          item({ label: "Open with", end: caret }),
          D.gap(),
          item({ label: "Copy path" }),
        );
  const dockSub = (w) =>
    menu(
      ...[
        "Visual Studio Code",
        "Cursor",
        "Zed",
        ...(w
          ? [
              "Sublime Text",
              "WebStorm",
              "Xcode",
              "Nova",
              "BBEdit",
              "TextMate",
              "Fleet",
              OV.long(0),
              "Android Studio",
            ]
          : []),
      ].map((n, i) => item({ label: n, state: i === 0 ? "hover" : "" })),
    );

  const projectRow = (p, o = {}) =>
    `<button class="menu-item ${o.state ? "is-" + o.state : ""}" role="option" ${o.current ? 'aria-current="true"' : ""}>${D.avatar(p.name)}<span class="t-ellipsis">${o.q ? hl(p.name, o.q) : esc(p.name)}</span>${o.current ? `<span class="menu-end">${D.icon("check", 16)}</span>` : p.ago ? `<span class="menu-end">${esc(p.ago)}</span>` : ""}</button>`;
  const hl = (name, q) => {
    const i = name.toLowerCase().indexOf(q.toLowerCase());
    return i < 0
      ? esc(name)
      : `${esc(name.slice(0, i))}<span class="t-strong">${esc(name.slice(i, i + q.length))}</span>${esc(name.slice(i + q.length))}`;
  };
  const projectMenu = (list, { q = "", empty, scroll = true } = {}) => {
    const shown = q ? list.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : list;
    return D.menu(`<div class="menu-search">${D.field({ icon: "search", placeholder: `Find in ${list.length} projects`, value: q, state: "focus", label: "Find a project" })}</div>
      <div class="menu-list ${scroll ? "scroll-show" : ""}" role="listbox">${empty || !shown.length ? `<div class="menu-empty">No project matches</div>` : shown.map((p, i) => projectRow(p, { current: !q && i === 1, state: i === 3 ? "hover" : "", q })).join("")}</div>
      ${D.sep()}${item({ icon: "folderOpen", label: "Open folder…", kbd: "⌘O" })}${item({ icon: "fork", label: "New worktree…" })}`);
  };

  const profileMenu = (w, data) => {
    const claude = data.profiles.map((p) => "claude" + (p.args ? " " + p.args : ""));
    const codex = [
      "codex",
      "codex --full-auto",
      ...(w ? ["codex --model " + OV.long(0) + " --profile " + OV.long(0)] : []),
    ];
    const radio = (cmd, on, state) =>
      `<button class="menu-item is-check ${state ? "is-" + state : ""}" role="menuitemradio" aria-checked="${on}">${on ? D.icon("check", 16) : '<span class="ico" aria-hidden="true"></span>'}<span class="t-ellipsis t-mono">${esc(cmd)}</span></button>`;
    return `<div class="col gap-4 ov-end"><span class="btn-split">${D.button({ label: "Run", variant: "primary", kbd: "↵" })}${D.button({ icon: "caretDown", variant: "primary" })}</span>
      ${D.menu(`${label("Claude Code")}${claude.map((c, i) => radio(c, i === 1, i === 2 ? "hover" : "")).join("")}${label("Codex")}${codex.map((c, i) => radio(c, i === 0)).join("")}${D.gap()}${item({ label: "Edit profiles in Settings…" })}`, { wide: true })}</div>`;
  };

  // Item states, as caps + one menu so the rows stay aligned (cap column mirrors the 32 rows).
  const STATE_ROWS = [
    ["rest", { icon: "copy", label: "Copy path" }],
    ["hover", { icon: "copy", label: "Copy path", state: "hover" }],
    ["focus-visible", { icon: "copy", label: "Copy path", state: "focus" }],
    ["pressed", { icon: "copy", label: "Copy path", state: "pressed" }],
    ["disabled", { icon: "branch", label: "Copy branch", state: "disabled" }],
    ["selected", { icon: "pin", label: "Pinned", state: "selected" }],
    ["selected + focus", { icon: "pin", label: "Pinned", state: "selected focus" }],
    ["destructive", { icon: "close", label: "Close", danger: true }],
    ["destructive hover", { icon: "close", label: "Close", danger: true, state: "hover" }],
    ["destructive pressed", { icon: "close", label: "Close", danger: true, state: "pressed" }],
    ["check item", { check: true, label: "Plan first" }],
    ["submenu item", { icon: "plus", label: "New here", end: caret }],
    ["shortcut item", { icon: "folderOpen", label: "Open folder…", kbd: "⌘O" }],
  ];
  const stateMenu = () =>
    `<div class="flex gap-12 top"><div class="gx-rowcaps">${STATE_ROWS.map(([n]) => `<span class="gx-cap">${n}</span>`).join("")}</div>${D.menu(STATE_ROWS.map(([, o]) => item(o)).join(""))}</div>`;

  OV.menus = (data, { worst }) => {
    const w = worst;
    const sideBy = (a, b) => `<div class="flex gap-4 top">${a}${b}</div>`;
    const wide = (cap, html) => OV.cell(cap, html, "ov-wide");
    return OV.sec(
      "menus  --elev-1",
      OV.grid(
        [
          wide("rail row menu, submenu open", sideBy(railMenu(w, true), railSub())),
          OV.cell("rail row menu, hover", railMenu(w, false)),
          OV.cell("checkout menu", checkoutMenu(w, "rest")),
          OV.cell("checkout menu, agents pending", checkoutMenu(w, "pending")),
          OV.cell("checkout menu, no quick agents", checkoutMenu(w, "none")),
          wide("dock file menu, Open with open", sideBy(dockMenu(w, false), dockSub(w))),
          OV.cell("dock file menu, deleted file", dockMenu(w, true)),
          OV.cell("launcher project menu, scrolling list", projectMenu(data.moreProjects)),
          OV.cell(
            "launcher project menu, filtered",
            projectMenu(data.moreProjects, { q: w ? "x" : "spacevibe" }),
          ),
          OV.cell(
            "launcher project menu, no match",
            projectMenu(data.moreProjects, { q: "zzz", empty: true }),
          ),
          wide("launcher profile menu", profileMenu(w, data)),
          OV.cell("item states", stateMenu()),
        ].join(""),
      ),
    );
  };

  /* ---------- popovers (--elev-1) ---------- */
  const attnRows = (list) =>
    list
      .map((a, i) =>
        D.row({
          agent: a.agent,
          title: a.title,
          meta: `<span class="t-ellipsis">${esc(a.project + " · " + a.ask)}</span>`,
          state: /fail|Tests/.test(a.ask) ? "failed" : "needs",
          end: `<span class="row-when">${esc(D.age(a.when))}</span>`,
          forced: i === 1 ? "hover" : "",
        }),
      )
      .join("");
  const attention = (list, { empty } = {}) =>
    empty
      ? `<div class="popover popover-list">${D.empty({ icon: "checkCircle", text: "Nothing needs you" })}</div>`
      : `<div class="popover popover-list"><div class="scroll">${attnRows(list)}</div></div>`;

  const devRow = (s, i) => {
    const dot = s.status === "up" ? "is-ok" : s.status === "starting" ? "is-need" : "is-fail";
    const acts =
      s.status === "up"
        ? D.iconButton({ icon: "external", size: 24, label: "Open", cls: "ib-hit" }) +
          D.iconButton({ icon: "stop", size: 24, label: "Stop", cls: "ib-hit" })
        : s.status === "starting"
          ? D.icon("loader", 14, "spin ico-faint")
          : D.iconButton({ icon: "play", size: 24, label: "Start", cls: "ib-hit" });
    return `<div class="row row-44 ${i === 0 ? "is-hover" : ""}"><span class="row-logo"><span class="dot ${dot}"></span></span><span class="row-main"><span class="row-title t-mono">${esc(s.name)}</span><span class="row-meta"><span class="t-ellipsis">:${s.port} · ${esc(s.cwd)}</span></span></span><span class="row-end">${acts}</span></div>`;
  };
  const devServers = (
    list,
    { empty } = {},
  ) => `<div class="popover popover-list">${D.sectionHead("Dev servers", { icon: "server", count: empty ? undefined : list.length })}<div class="pad-4">${D.select({ value: "This project", icon: "folder", size: 28 })}</div>
    ${empty ? D.empty({ icon: "server", text: "No dev servers" }) : `<div class="scroll">${list.map(devRow).join("")}</div>`}</div>`;

  const TEMPLATES = [
    ["Review the diff", "Look at the staged diff and list risks before I commit.", true],
    ["Explain this file", "Explain what the open file does, in plain words.", false],
    [
      "Write the test first",
      "Write a failing test for the behaviour I describe, then stop.",
      false,
    ],
  ];
  const promptRow = ([n, b, auto], i) =>
    `<div class="row row-44 ${i === 0 ? "is-hover" : ""}"><span class="row-main"><span class="row-title">${esc(n)}</span><span class="row-meta"><span class="t-ellipsis">${esc(b)}</span></span></span><span class="row-end">${auto ? D.badge("Send") : D.badge("Paste")}${D.iconButton({ icon: "edit", size: 24, label: "Edit", cls: "ib-hit" })}</span></div>`;
  const promptList = (w, empty) =>
    `<div class="popover popover-list">${empty ? D.empty({ icon: "comment", text: "No templates yet" }) : `<div class="scroll">${(w ? [...TEMPLATES, ...TEMPLATES.map(([, b, a], i) => [OV.long(i), b + " " + b, a])] : TEMPLATES).map(promptRow).join("")}</div>`}${empty ? D.gap() : D.sep()}${item({ icon: "plus", label: "New template" })}</div>`;
  const promptEdit = (w) => `<div class="popover"><div class="form">
      ${D.field({ placeholder: "name", value: w ? OV.long(0) : "Review the diff", label: "Template name" })}
      <label class="field field-area sz-32"><textarea rows="3" aria-label="Template body" placeholder="the prompt to paste">${esc(w ? OV.long(0).repeat(3) : "Look at the staged diff and list risks before I commit.")}</textarea></label>
      <div class="form-row"><span class="flex gap-8">${D.toggle(true, { label: "Auto send" })}Auto send</span><span class="flex gap-4">${D.iconButton({ icon: "trash", label: "Remove" })}${D.button({ label: "Save", variant: "primary" })}</span></div>
      <div class="flex gap-8">${D.select({ value: "Skill", size: 28, cls: "grow" })}${D.select({ value: "Subagent", size: 28, cls: "grow" })}</div></div></div>`;

  OV.popovers = (data, { worst }) =>
    OV.sec(
      "popovers  --elev-1",
      OV.grid(
        [
          OV.cell("attention", attention(data.attention)),
          OV.cell("attention, empty", attention([], { empty: true })),
          OV.cell("dev servers", devServers(data.devServers)),
          OV.cell("dev servers, empty", devServers([], { empty: true })),
          OV.cell("prompt, list", promptList(worst)),
          OV.cell("prompt, empty", promptList(worst, true)),
          OV.cell("prompt, editing a template", promptEdit(worst)),
        ].join(""),
        "calc(var(--popover-w) + var(--space-16))",
      ),
    );

  /* ---------- tooltips (--elev-1) ---------- */
  const tip = (text, k) =>
    `<span class="tip" role="tooltip"><span class="t-wrap">${esc(text)}</span>${k ? D.kbd(k) : ""}</span>`;
  const anchor = (btn, t) => `<div class="col gap-4 top">${btn}${t}</div>`;
  OV.tooltips = (data, { worst }) =>
    OV.sec(
      "tooltips  --elev-1",
      OV.grid(
        [
          OV.cell(
            "plain",
            anchor(
              D.iconButton({ icon: "archive", label: "Archive", state: "hover" }),
              tip(worst ? OV.long(0) : "Archive"),
            ),
          ),
          OV.cell(
            "action tooltip, chord badge",
            anchor(
              D.iconButton({ icon: "plus", label: "New agent", state: "focus" }),
              tip(worst ? "Open a new agent in the checkout " + OV.long(0) : "New agent", "⌘T"),
            ),
          ),
          OV.cell(
            "action tooltip, multi-modifier chord",
            anchor(
              D.iconButton({ icon: "sidebarRight", label: "Toggle dock", state: "hover" }),
              tip("Toggle dock", worst ? "⌃⌥⇧⌘F12" : "⌘⌥B"),
            ),
          ),
          OV.cell(
            "disabled reason, no chord",
            anchor(
              D.iconButton({ icon: "diff", label: "Commit", state: "disabled" }),
              tip("Nothing to commit"),
            ),
          ),
          OV.cell(
            "wrapped at the max width",
            anchor(
              D.chip({ label: "main", icon: "branch", state: "hover" }),
              tip("Closes every tab and agent of this project and takes it off the rail.", "⌘W"),
            ),
          ),
          OV.cell(
            "one letter",
            anchor(D.iconButton({ icon: "more", label: "More", state: "hover" }), tip("x")),
          ),
        ].join(""),
        "calc(var(--tip-max-w) + var(--space-24))",
      ),
    );
})();
