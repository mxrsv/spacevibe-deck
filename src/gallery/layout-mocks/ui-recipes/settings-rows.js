/* =====================================================================================
   settings-rows.js: Settings tab, part 2 of 2: each row pattern once, with its states.
   Mirrors command-settings-live-row.tsx (toggle, select), command-settings-shortcut-row.tsx,
   command-settings-agent-row.tsx + -identities.tsx + -add-command.tsx (editable list) and
   theme-gallery.tsx (theme cards). Needs settings.js (window.CS) first.
   ===================================================================================== */
(function () {
  "use strict";
  const D = window.Deck;
  const CS = window.CS;
  const { esc } = D;

  const STATES = [
    ["rest", ""],
    ["hover", "is-hover"],
    ["active (arrow keys)", "is-focus"],
    ["pressed", "is-pressed"],
    ["disabled (list inert)", "is-disabled"],
  ];
  const byState = (make) => STATES.map(([c, st]) => [c, make(st)]);

  /* ---------- toggle row ---------- */
  const toggleRows = (data, w) => {
    const t = data.settings.toggles;
    const lab = (i) => (w ? CS.long : t[i].label);
    return (
      CS.pattern([
        ["on", CS.row({ label: lab(0), ctl: D.toggle(true) })],
        ["off", CS.row({ label: lab(2), ctl: D.toggle(false) })],
        ...byState((st) => CS.row({ label: lab(1), ctl: D.toggle(true), st })).slice(1),
        ["changed: reset shown", CS.row({ label: lab(0), ctl: D.toggle(false), reset: true })],
        ["with area crumb", CS.row({ label: lab(1), crumb: "Notifications", ctl: D.toggle(true) })],
      ]) +
      CS.strip([
        ["switch on", D.toggle(true)],
        ["switch off", D.toggle(false)],
        ["hover", D.toggle(false, { state: "hover" })],
        ["focus-visible", D.toggle(true, { state: "focus" })],
        ["disabled on", D.toggle(true, { state: "disabled" })],
        ["disabled off", D.toggle(false, { state: "disabled" })],
      ])
    );
  };

  /* ---------- select row ---------- */
  const selectRows = (data, w) => {
    const s = data.settings.selects;
    const sel = (state) =>
      D.select({
        value: w ? "JetBrains Mono Nerd Font Propo Extra Long Name" : s[1].value,
        size: 28,
        state,
      });
    const open = `<div class="cs-menu-end">${D.menu(s[1].options.map((o, i) => D.menuItem({ label: o, check: i === 0, cls: i === 1 ? "is-hover" : "" })).join(""))}</div>`;
    return (
      CS.pattern([
        ...byState((st) => CS.row({ label: w ? CS.long : s[1].label, ctl: sel(""), st })),
        [
          "changed: reset shown",
          CS.row({
            label: s[0].label,
            ctl: D.select({ value: s[0].value, size: 28 }),
            reset: true,
          }),
        ],
        [
          "open: pressed select + menu",
          CS.row({
            label: s[1].label,
            ctl: D.select({ value: s[1].value, size: 28, state: "pressed" }),
            below: open,
          }),
        ],
      ]) +
      CS.strip([
        ["select rest", sel("")],
        ["hover", sel("hover")],
        ["focus-visible", sel("focus")],
        ["pressed", sel("pressed")],
        ["disabled", sel("disabled")],
      ])
    );
  };

  /* ---------- shortcut row ---------- */
  const chordCtl = (chords, btn = "Change") =>
    `${chords.length ? chords.map((c) => D.kbd(c)).join("") : '<span class="t-muted">Unbound</span>'}${D.button({ label: btn, variant: "ghost", size: 28 })}`;
  const shortcutRows = (data, w) => {
    const sc = data.settings.shortcuts;
    const lab = (i) => (w ? sc[0].label : sc[i].label);
    const ch = (i) => (w ? sc[0].chord : sc[i].chord);
    return (
      CS.pattern([
        ["bound", CS.row({ label: lab(0), ctl: chordCtl([ch(0)]) })],
        ["two chords", CS.row({ label: lab(1), ctl: chordCtl([ch(1), "⌘P"]) })],
        ["hover", CS.row({ label: lab(2), ctl: chordCtl([ch(2)]), st: "is-hover" })],
        ["active (arrow keys)", CS.row({ label: lab(2), ctl: chordCtl([ch(2)]), st: "is-focus" })],
        ["unbound", CS.row({ label: lab(3), ctl: chordCtl([], "Record") })],
        [
          "recording (listening)",
          CS.row({
            label: lab(0),
            ctl: `<span role="status">Press the new shortcut</span>${D.button({ label: "Cancel", size: 28 })}`,
            st: "is-focus",
          }),
        ],
        ["changed: reset shown", CS.row({ label: lab(1), ctl: chordCtl(["⌘⇧O"]), reset: true })],
        [
          "conflict: also bound",
          CS.row({
            label: lab(0),
            ctl: chordCtl(["⌘⌥B"]),
            below: `<div class="flex gap-8 t-meta cs-below"><span class="grow t-ellipsis">Also bound to Toggle dock</span>${D.chip({ label: "Reassign" })}</div>`,
          }),
        ],
        [
          "disabled (list inert)",
          CS.row({ label: lab(2), ctl: chordCtl([ch(2)]), st: "is-disabled" }),
        ],
      ]) +
      CS.strip([
        ["Change", D.button({ label: "Change", variant: "ghost", size: 28 })],
        [
          "Change, hover",
          D.button({ label: "Change", variant: "ghost", size: 28, state: "hover" }),
        ],
        [
          "Change, pressed",
          D.button({ label: "Change", variant: "ghost", size: 28, state: "pressed" }),
        ],
        ["Cancel while recording", D.button({ label: "Cancel", size: 28 })],
        [
          "Record, disabled",
          D.button({ label: "Record", variant: "ghost", size: 28, state: "disabled" }),
        ],
      ])
    );
  };

  /* ---------- editable list: agents (add, remove, expand) ---------- */
  const detail = (label, ctl) =>
    `<div class="flex between gap-16 cs-detail"><span class="t-ellipsis">${esc(label)}</span><span class="set-control">${ctl}</span></div>`;
  const agentDetails = () =>
    `<div class="col gap-2 cs-indent">${detail("Quick launch", D.toggle(true))}${detail("Signals", D.toggle(true))}${detail("Command", D.field({ value: "claude", size: 28, cls: "cs-field" }) + D.iconButton({ icon: "undo", size: 24, label: "Reset command" }))}${detail("Model", D.select({ value: "Opus 5.5", size: 28 }))}${detail("Effort", D.select({ value: "High", size: 28 }))}</div>`;
  const customDetails = (error) =>
    `<div class="col gap-2 cs-indent"><div class="flex gap-8 cs-detail">${D.field({ value: "Aider", size: 28, cls: "cs-field" })}${D.field({ value: "aider --model sonnet", size: 28, cls: "grow" })}${D.iconButton({ icon: "trash", size: 24, label: "Remove Aider" })}</div>${error ? `<span class="note-line is-fail cs-detail">${D.icon("alertCircle", 12)}${esc(error)}</span>` : ""}</div>`;
  const agentRow = (
    a,
    { status, st = "", on = true, open = false, install = false, below = "" } = {},
  ) =>
    CS.row({
      label: a.name,
      lead: D.agentLogo(a.id, 16),
      crumb: null,
      st,
      ctl: `${status ? `<span class="t-meta">${status}</span>` : `<span class="t-meta t-mono t-ellipsis cs-cmd">${esc(a.cmd)}</span>`}${install ? D.button({ label: "Install", size: 28 }) : ""}${D.toggle(on && !install, { state: install ? "disabled" : "" })}${D.iconButton({ icon: open ? "caretDown" : "caretRight", size: 24, label: "Configure " + a.name })}`,
      below,
    });
  const agentList = (data, w) => {
    const ag = data.settings.agents;
    const extra = w ? ag.slice(5) : [];
    const addAgent = (error) =>
      CS.row({
        label: "Add agent",
        ctl: `${D.field({ placeholder: "Name", size: 28, cls: "cs-field" })}${D.field({ placeholder: "command", size: 28, cls: "cs-field" })}${D.iconButton({ icon: "plus", label: "Add agent" })}`,
        below: error
          ? `<span class="note-line is-fail cs-detail">${D.icon("alertCircle", 12)}${esc(error)}</span>`
          : "",
      });
    return CS.pattern([
      ["ready, command shown", agentRow(ag[0])],
      ["hover", agentRow(ag[1], { st: "is-hover" })],
      ["active (arrow keys)", agentRow(ag[1], { st: "is-focus" })],
      ["off", agentRow(ag[3], { status: "Off", on: false })],
      [
        "not installed: install offered",
        agentRow(ag[2], { status: "Not installed", install: true }),
      ],
      [
        "looking for the CLI",
        agentRow(ag[4], { status: `${D.icon("loader", 12, "spin")} Looking…` }),
      ],
      ["expanded: built-in details", agentRow(ag[0], { open: true, below: agentDetails() })],
      [
        "expanded: custom agent, remove",
        CS.row({
          label: "Aider",
          lead: D.agentLogo("shell", 16),
          ctl: `<span class="t-meta t-mono cs-cmd">aider --model sonnet</span>${D.toggle(true)}${D.iconButton({ icon: "caretDown", size: 24, label: "Configure Aider" })}`,
          below: customDetails(""),
        }),
      ],
      [
        "custom agent, name taken",
        CS.row({
          label: "Aider",
          lead: D.agentLogo("shell", 16),
          ctl: `<span class="t-meta t-mono cs-cmd">aider</span>${D.toggle(true)}${D.iconButton({ icon: "caretDown", size: 24, label: "Configure Aider" })}`,
          below: customDetails("Another agent already uses that name"),
        }),
      ],
      ...extra.map((a, i) => [
        i === 0 ? "worst: long names, more rows" : "",
        agentRow({ ...a, cmd: a.cmd }, { on: a.enabled }),
      ]),
      ["add an agent", addAgent("")],
      ["add an agent, rejected", addAgent("That command is already in the list")],
      [
        "add a launch command",
        CS.row({
          label: "Add command",
          ctl: `${D.field({ placeholder: "claude --model opus", size: 28, cls: "cs-field" })}${D.iconButton({ icon: "plus", label: "Add command" })}`,
        }),
      ],
      [
        "detected + refresh",
        `<div class="flex between gap-8 t-meta cs-detail"><span>${data.settings.agents.length} detected</span>${D.button({ label: "Refresh", icon: "refresh", size: 28 })}</div>`,
      ],
    ]);
  };

  /* ---------- theme cards ---------- */
  const THEMES = [
    ["Deck Light", "light", "#f5f6f8", "#e9eaec", "#272727", "#245fca"],
    ["Paper", "light", "#fbf8f1", "#efe9dc", "#2b2a27", "#b4541a"],
    ["Daylight", "light", "#ffffff", "#f0f2f5", "#1f2328", "#0969da"],
    ["Graphite", "dark", "#191c20", "#24272b", "#e7e8e9", "#47bfc5"],
    ["Nova", "dark", "#1b1e28", "#252938", "#d9dce8", "#8a7dff"],
    ["Midnight", "dark", "#0e1116", "#161b22", "#c9d1d9", "#58a6ff"],
    ["Ember", "dark", "#1c1816", "#26201d", "#ecdcd0", "#e8927a"],
  ];
  const card = ([name, , bg, side, fg, accent], state = "", sel = false) =>
    `<button class="theme-card ${state} ${sel ? "is-selected" : ""}" aria-pressed="${sel}"><span class="theme-card-swatch"><span style="background:${side}"></span><span class="flex center gap-4" style="background:${bg};color:${fg}"><span class="t-strong">Aa</span><span class="dot" style="--dot:${accent}"></span></span></span><span class="flex gap-6"><span class="t-ellipsis grow">${esc(name)}</span>${sel ? D.icon("check", 14) : ""}</span></button>`;
  const themes = (data, w) => {
    const list = THEMES.map((t, i) =>
      w && i === 1
        ? ["Paper with an unreasonably long theme name that never ends", ...t.slice(1)]
        : t,
    );
    const group = (label, items, cap) =>
      `<div class="col gap-4">${D.sectionHead(label)}<div class="flex wrap gap-8">${items.map(([t, st, sel]) => CS.cell(cap ? st || (sel ? "selected" : "rest") : "", card(t, st, sel))).join("")}</div></div>`;
    const g = (type, sel) => list.filter((t) => t[1] === type).map((t) => [t, "", t[0] === sel]);
    return (
      `<div class="panel cs-frame pad-12 col gap-12">${group("Light", g("light", "Deck Light"))}${group("Dark", g("dark", "Graphite"))}${group("Custom", [[["Imported: Solarized", "custom", "#002b36", "#073642", "#93a1a1", "#b58900"], "", false]])}</div>` +
      CS.strip([
        ["rest", card(list[0])],
        ["hover", card(list[0], "is-hover")],
        ["focus-visible", card(list[0], "is-focus")],
        ["pressed", card(list[0], "is-pressed")],
        ["selected", card(list[3], "", true)],
        ["selected + focus", card(list[3], "is-focus", true)],
        ["disabled", card(list[0], "is-disabled")],
      ])
    );
  };

  CS.rows = (data, { worst }) => {
    const w = worst;
    return (
      CS.sec("row pattern: toggle", toggleRows(data, w)) +
      CS.sec("row pattern: select", selectRows(data, w)) +
      CS.sec("row pattern: shortcut (chord badge, capture)", shortcutRows(data, w)) +
      CS.sec("row pattern: editable list, agents (add, remove, expand)", agentList(data, w)) +
      CS.sec("row pattern: theme cards", themes(data, w))
    );
  };
})();
