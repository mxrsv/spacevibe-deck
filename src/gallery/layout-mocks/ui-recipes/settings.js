/* =====================================================================================
   settings.js: Settings tab, part 1 of 2 (shared helpers, the Command Settings frame and its
   states). Part 2: settings-rows.js (each row pattern). Mirrors src/ui/command-settings/
   (command-settings.tsx, -frame.tsx, -rows.tsx). Only chrome.css recipes through window.Deck.
   ===================================================================================== */
(function () {
  "use strict";
  const D = window.Deck;
  const CS = (window.CS = window.CS || {});
  const { esc } = D;

  /* ---------- review helpers ---------- */
  CS.long = "Ask before running a command that is not on the allow list for this checkout";
  CS.cap = (t) => `<span class="gx-cap">${esc(t)}</span>`;
  CS.cell = (cap, html, cls = "") =>
    `<div class="gx-cell ${cls}">${cap ? CS.cap(cap) : ""}${html}</div>`;
  CS.sec = (title, body) => `<section><h3 class="gx-h">${title}</h3>${body}</section>`;
  CS.strip = (cells) =>
    `<div class="cs-strip">${cells.map(([c, h]) => CS.cell(c, h)).join("")}</div>`;
  CS.bed = (inner, { rows = 8, scrim = true } = {}) => D.backdrop(inner, { rows, scrim });
  // Rows beside their state names: one panel spanning the rows through a subgrid, so each cap lines up with its row.
  CS.pattern = (rows) =>
    `<div class="cs-pat"><div class="panel cs-pat-panel" style="grid-row:1 / span ${rows.length + 2}"><span></span>${rows.map(([, h]) => `<div class="minw0">${h}</div>`).join("")}<span></span></div>${rows.map(([c], i) => `<span class="gx-cap flex" style="grid-row:${i + 2};grid-column:1">${esc(c)}</span>`).join("")}</div>`;

  /* ---------- row anatomy: label (+ area crumb) left, control right, optional line below ---------- */
  CS.row = ({ label, crumb, lead = "", ctl = "", reset = false, st = "", below = "" }) =>
    `<div class="col"><div class="row set-row ${st}"><span class="set-label flex gap-8 minw0">${lead}<span class="t-ellipsis">${esc(label)}</span>${crumb ? `<span class="t-meta none">${esc(crumb)}</span>` : ""}</span><span class="set-control">${reset ? D.iconButton({ icon: "undo", size: 24, label: "Reset " + label }) : ""}${ctl}</span></div>${below}</div>`;
  // Hit row: whole line is the target; area hits end in a caret, setting hits end in their current value.
  CS.hit = ({ label, crumb, value, area, st = "" }) =>
    `<div class="row set-row ${st}"><span class="set-label flex gap-8 minw0"><span class="t-ellipsis">${esc(label)}</span>${crumb ? `<span class="t-meta none">${esc(crumb)}</span>` : ""}</span>${area ? D.icon("caretRight", 16, "ico-muted") : `<span class="t-muted t-ellipsis cs-value">${esc(value)}</span>`}</div>`;
  CS.attn = (text, crumb, tone = "fail") =>
    `<div class="row set-row"><span class="set-label flex gap-8 minw0"><span class="dot is-${tone}"></span><span class="t-ellipsis">${esc(text)}</span></span><span class="t-meta">${esc(crumb)}</span></div>`;

  /* ---------- frame parts ---------- */
  const AREAS = [
    "Appearance",
    "Browser",
    "Terminal",
    "Agents",
    "Links & editor",
    "Shortcuts",
    "Notifications",
    "About",
    "Privacy",
    "Reset",
  ];
  CS.search = ({ q = "", scope = null, state = "focus" } = {}) =>
    `<label class="field sz-32 ${state ? "is-" + state : ""}">${D.icon("search", 16)}${scope ? `${D.badge(scope)}${D.iconButton({ icon: "close", size: 20, label: "Leave " + scope })}` : ""}<input value="${esc(q)}" placeholder="${scope ? "Filter" : "Search settings, agents, shortcuts"}" aria-label="Search settings" tabindex="-1"></label>`;
  CS.chips = (selected, forced = {}) =>
    `<div class="flex wrap gap-2" role="group" aria-label="Areas">${AREAS.map((a) => D.chip({ label: a, state: a === selected ? "selected" : forced[a] })).join("")}</div>`;
  const hint = (k, t) => `<span class="flex gap-6">${D.kbd(k)}${esc(t)}</span>`;
  CS.footer = ({ move = true, enter = "Open", esc: e = "Close" } = {}) =>
    `<div class="panel-foot">${move ? hint("↑↓", "Move") : ""}${enter ? hint("↵", enter) : ""}${hint("Esc", e)}</div>`;
  CS.status = (t) => `<span class="gx-cap">status, read by screen readers only: “${esc(t)}”</span>`;
  CS.frame = ({
    q,
    scope,
    body,
    foot,
    selected,
  }) => `<div class="panel col cs-frame" role="dialog" aria-label="Settings"><div class="col gap-8 pad-12">${CS.search({ q, scope })}${CS.chips(selected)}</div>
    <div class="scroll col gap-2 pad-8 cs-list" role="region" aria-label="Results">${body}</div>${foot || CS.footer()}</div>`;

  const head = (t) => D.sectionHead(t);
  const crumbRows = (data, w) => {
    const s = data.settings;
    return (
      head("Needs attention") +
      CS.attn(w ? CS.long : "Claude Code is not installed", "Agents") +
      head("Notifications") +
      CS.row({
        label: w ? CS.long : s.toggles[1].label,
        crumb: "Notifications",
        ctl: D.toggle(true, { label: s.toggles[1].label }),
        st: "is-focus",
      }) +
      head("Terminal") +
      CS.row({
        label: s.selects[1].label,
        crumb: "Terminal",
        ctl: D.select({ value: s.selects[1].value, size: 28 }),
      }) +
      head("Shortcuts") +
      CS.row({
        label: s.shortcuts[0].label,
        crumb: "Shortcuts",
        ctl:
          D.kbd(s.shortcuts[0].chord) + D.button({ label: "Change", variant: "ghost", size: 28 }),
      })
    );
  };
  const hits = (data, w) =>
    [
      CS.hit({ label: "Terminal font", crumb: "Terminal", value: "SF Mono", st: "is-focus" }),
      CS.hit({ label: w ? CS.long : "Font size", crumb: "Terminal", value: "13" }),
      CS.hit({
        label: w ? "数据分析平台-大数据可视化项目" : "Tab bar position",
        crumb: "Appearance",
        value: w ? CS.long : "Sidebar",
      }),
      CS.hit({ label: "Terminal", area: true }),
    ].join("");

  CS.frames = (data, { worst }) => {
    const w = worst;
    const bed = (inner, o) => CS.bed(inner, o);
    const full = bed(CS.frame({ body: crumbRows(data, w) }), { rows: 12 });
    const states = [
      [
        "scoped to an area",
        CS.frame({
          scope: "Agents",
          selected: "Agents",
          q: "",
          body:
            CS.row({
              label: "Claude Code",
              lead: D.agentLogo("claude", 16),
              ctl: D.toggle(true),
              st: "is-focus",
            }) + CS.row({ label: "Codex", lead: D.agentLogo("codex", 16), ctl: D.toggle(true) }),
          sr: "",
        }),
      ],
      [
        "query with hits",
        CS.frame({ q: "font", body: hits(data, w), foot: CS.footer({ enter: "Open" }) }),
      ],
      [
        "no match",
        CS.frame({
          q: "zzz",
          body: `<div class="empty">${D.icon("search", 16, "ico-faint")}<span>Nothing matches <span class="t-strong">“zzz”</span></span>${D.button({ label: "Clear search", size: 28 })}</div>`,
          foot: CS.footer({ move: false, enter: null }),
        }),
      ],
      [
        "loading: list inert, search and chips live",
        CS.frame({ body: D.skeleton(5), foot: CS.footer({ move: false, enter: null }) }),
      ],
      [
        "load error",
        CS.frame({
          body: `<div class="notice notice-fail">${D.icon("alertCircle", 16)}<span class="notice-text">Could not read your settings.</span>${D.button({ label: "Retry", size: 28 })}</div>${D.skeleton(3)}`,
          foot: CS.footer({ move: false, enter: null }),
        }),
      ],
    ];
    const bedFor = ([c, h]) => CS.cell(c, bed(h, { rows: 9 }));
    const status = CS.strip([
      ["results status: query", CS.status(w ? "9,999 results" : "3 results")],
      ["results status: one", CS.status("1 result")],
      ["results status: none", CS.status("No results")],
      ["results status: no query", CS.status("")],
    ]);
    return (
      CS.sec(
        "frame: a floating panel over the dimmed window",
        CS.cell("browse, no query, no scope", full),
      ) +
      CS.sec("frame states", `<div class="cs-two">${states.map(bedFor).join("")}</div>${status}`) +
      CS.sec(
        "frame parts: search field",
        CS.strip([
          ["rest", CS.search({ state: "" })],
          ["hover", CS.search({ state: "hover" })],
          ["focus", CS.search({})],
          ["with text", CS.search({ q: w ? CS.long : "shortcut", state: "" })],
          ["scope badge", CS.search({ scope: "Agents" })],
          [
            "scope badge, worst name",
            CS.search({
              scope: w ? "Links & editor and a long scope" : "Links & editor",
              state: "",
            }),
          ],
        ]),
      ) +
      CS.sec(
        "frame parts: area chips",
        CS.strip([
          ["rest", CS.chips(null)],
          ["hover on Terminal", CS.chips(null, { Terminal: "hover" })],
          ["focus-visible on Agents", CS.chips(null, { Agents: "focus" })],
          ["selected Agents", CS.chips("Agents")],
          ["pressed on About", CS.chips(null, { About: "pressed" })],
          [
            "disabled",
            `<div class="flex wrap gap-2 is-disabled">${AREAS.map((a) => D.chip({ label: a })).join("")}</div>`,
          ],
        ]),
      ) +
      CS.sec(
        "frame parts: footer",
        CS.strip([
          ["list with a row", `<div class="panel cs-frame">${CS.footer()}</div>`],
          [
            "toggle row active",
            `<div class="panel cs-frame">${CS.footer({ enter: "Toggle" })}</div>`,
          ],
          [
            "nothing to walk",
            `<div class="panel cs-frame">${CS.footer({ move: false, enter: null })}</div>`,
          ],
          [
            "recording a shortcut",
            `<div class="panel cs-frame">${CS.footer({ move: false, enter: null, esc: "Cancel" })}</div>`,
          ],
        ]),
      )
    );
  };
})();
