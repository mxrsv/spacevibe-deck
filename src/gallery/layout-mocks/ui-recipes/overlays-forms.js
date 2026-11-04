/* =====================================================================================
   overlays-forms.js: Overlays tab, part 3 of 3 (forms and the usage details page).
   Mirrors project-rail-worktree-form.tsx, stage-launcher-form.tsx (clone-workspace-form.tsx,
   create-workspace-form.tsx) and usage-page.tsx (usage-body sections). Needs overlays.js first.
   ===================================================================================== */
(function () {
  "use strict";
  const D = window.Deck;
  const OV = window.OV;
  const { esc } = D;
  const L = OV.long;

  /* ---------- worktree form (rail create row popover) ---------- */
  const wtForm = (w, o = {}) => {
    const dis = o.creating ? "disabled" : "";
    if (o.created)
      return `<div class="popover" role="status"><span class="note-line t-ok">${D.icon("checkCircle", 12)}Created ${esc(w ? L(0) : "feature/launcher-menu")}. Nothing was started.</span><div class="popover-foot">${D.button({ label: "Close" })}</div></div>`;
    return `<form class="popover" aria-label="New worktree"><div class="form">
      ${D.select({ value: w ? L(0) : "spacevibe-deck", icon: "folder", state: dis })}
      ${D.field({ placeholder: "feature/my-branch", value: o.branch === undefined ? "" : w ? L(0) : o.branch, state: dis || (o.branch ? "" : "focus"), error: Boolean(o.error), label: "Branch" })}
      ${o.branch ? D.field({ value: w ? "~/Development/" + L(0) + "-worktrees/" + L(0) : "~/Development/spacevibe-deck-worktrees/launcher-menu", state: dis, label: "Location" }) : ""}
      ${o.error ? `<span class="note-line is-fail" role="alert">${D.icon("alertCircle", 12)}<span class="t-wrap">${esc(o.error)}</span></span>` : ""}</div>
      <div class="popover-foot">${D.button({ label: "Cancel", variant: "ghost" })}${D.button({ label: o.creating ? "Creating…" : "Create", variant: "primary", icon: o.creating ? "loader" : "", spin: o.creating, state: o.branch && !o.creating ? "" : "disabled" })}</div></form>`;
  };

  /* ---------- stage-slot forms: clone and create workspace ---------- */
  const slot = (inner) =>
    `<div class="win-rail rel fill" style="min-height:calc(var(--row-44) * 10)"><div class="pad-16 col center grow"><div class="panel pad-16 form" style="width:100%;max-width:var(--launcher-w);align-self:center">${inner}</div></div></div>`;
  const head = (t) =>
    `<div class="flex gap-8">${D.iconButton({ icon: "back", label: "Back" })}<span class="t-dialog grow t-ellipsis">${t}</span>${D.iconButton({ icon: "close", label: "Close" })}</div>`;
  const labeled = (name, ctl, err) =>
    `<div class="form-field"><span class="field-label">${name}</span>${ctl}${err ? `<span class="note-line is-fail">${D.icon("alertCircle", 12)}${esc(err)}</span>` : ""}</div>`;
  const status = (text, { pct, icon, tone = "" } = {}) =>
    `<div class="col gap-6" role="status"><div class="flex gap-6 t-meta ${tone}">${icon || ""}<span class="grow t-ellipsis t-wrap">${esc(text)}</span>${pct != null ? `<span class="t-num">${pct}%</span>` : ""}</div>${pct != null ? D.meter(pct) : ""}</div>`;
  const foot = (...b) => `<div class="modal-foot">${b.join("")}</div>`;

  const clone = (w, o = {}) => {
    const d = o.busy ? "disabled" : "";
    const repo = o.repo === undefined ? "" : w ? "owner/" + L(0) : o.repo;
    const name = o.repo === undefined ? "" : w ? L(0) : "spacevibe-deck";
    const fields =
      labeled(
        "GitHub repository",
        D.field({
          placeholder: "owner/repo or https://github.com/owner/repo",
          value: repo,
          state: d || (o.repo === undefined ? "focus" : ""),
          label: "GitHub repository",
        }),
      ) +
      labeled(
        "Parent folder",
        D.select({
          icon: "folder",
          value: w ? "~/Development/" + L(0) : "~/Development",
          state: d,
        }),
      ) +
      labeled(
        "Folder name",
        D.field({ value: name, placeholder: "repository name", state: d, label: "Folder name" }),
      ) +
      labeled(
        "Final path",
        `<span class="t-meta t-mono t-wrap">${esc(name ? (w ? "~/Development/" + L(0) + "/" + L(0) : "~/Development/spacevibe-deck") : "")}&nbsp;</span>`,
      );
    const tail =
      o.view === "progress"
        ? status("Receiving objects…", { pct: 62 }) + foot(D.button({ label: "Cancel" }))
        : o.view === "cancelling"
          ? status("Cancelling…", { icon: D.icon("loader", 12, "spin") }) +
            foot(D.button({ label: "Cancel", state: "disabled" }))
          : o.view === "adding"
            ? status("Adding workspace…", { icon: D.icon("loader", 12, "spin") })
            : o.view === "added"
              ? status("Added", { icon: D.icon("checkCircle", 12), tone: "t-ok" })
              : o.view === "failed"
                ? status(
                    w
                      ? "Repository not found: " + L(0)
                      : "Repository not found. Check the name and your access.",
                    { icon: D.icon("alertCircle", 12), tone: "t-fail" },
                  ) + foot(D.button({ label: "Try again", variant: "primary" }))
                : o.view === "cancelled"
                  ? status("The clone was cancelled.", { icon: D.icon("info", 12) }) +
                    foot(D.button({ label: "Start over", variant: "primary" }))
                  : foot(
                      D.button({
                        label: "Clone",
                        variant: "primary",
                        kbd: "↵",
                        state: o.repo === undefined ? "disabled" : "",
                      }),
                    );
    return slot(head("Clone repository") + fields + tail);
  };

  const create = (w, o = {}) =>
    slot(
      head("Create workspace") +
        labeled(
          "Parent folder",
          D.select({
            icon: "folder",
            value: w ? "~/Development/" + L(0) : "~/Development",
            state: o.creating ? "disabled" : "",
          }),
        ) +
        labeled(
          "Folder name",
          D.field({
            placeholder: "my-new-project",
            value: o.name === undefined ? "" : w ? L(0) : o.name,
            error: Boolean(o.error),
            state: o.creating ? "disabled" : "focus",
            label: "Folder name",
          }),
          o.error,
        ) +
        (o.creating ? status("Creating…", { icon: D.icon("loader", 12, "spin") }) : "") +
        foot(
          D.button({
            label: o.creating ? "Creating…" : "Create",
            variant: "primary",
            state: o.name && !o.error && !o.creating ? "" : "disabled",
          }),
        ),
    );

  OV.forms = (data, { worst }) => {
    const w = worst;
    const wt = OV.grid(
      [
        OV.cell("worktree form, empty", wtForm(w, {})),
        OV.cell("worktree form, filled", wtForm(w, { branch: "launcher-menu" })),
        OV.cell("worktree form, creating", wtForm(w, { branch: "launcher-menu", creating: true })),
        OV.cell(
          "worktree form, error",
          wtForm(w, {
            branch: "launcher-menu",
            error: "A branch named launcher-menu already exists in this repository.",
          }),
        ),
        OV.cell("worktree form, created", wtForm(w, { created: true })),
      ].join(""),
      "calc(var(--popover-w) + var(--space-16))",
    );
    const two = (cells) =>
      `<div class="ov-two">${cells.map(([c, h]) => OV.cell(c, h)).join("")}</div>`;
    return (
      OV.sec("forms: worktree", wt) +
      OV.sec(
        "forms: clone repository, in the stage slot",
        two([
          ["empty", clone(w)],
          ["filled", clone(w, { repo: "mxrsv/spacevibe-deck" })],
          ["progress", clone(w, { repo: "mxrsv/spacevibe-deck", busy: true, view: "progress" })],
          [
            "cancelling",
            clone(w, { repo: "mxrsv/spacevibe-deck", busy: true, view: "cancelling" }),
          ],
          [
            "adding workspace",
            clone(w, { repo: "mxrsv/spacevibe-deck", busy: true, view: "adding" }),
          ],
          ["added", clone(w, { repo: "mxrsv/spacevibe-deck", busy: true, view: "added" })],
          ["failed", clone(w, { repo: "mxrsv/spacevibe-deck", view: "failed" })],
          ["cancelled", clone(w, { repo: "mxrsv/spacevibe-deck", view: "cancelled" })],
        ]),
      ) +
      OV.sec(
        "forms: create workspace, in the stage slot",
        two([
          ["empty", create(w)],
          ["valid", create(w, { name: "my-new-project" })],
          [
            "invalid name",
            create(w, {
              name: "my.project/x",
              error: "Choose a folder name without dots or path separators",
            }),
          ],
          ["creating", create(w, { name: "my-new-project", creating: true })],
        ]),
      )
    );
  };

  /* ---------- usage details page ---------- */
  const NUMS = (w) =>
    w
      ? ["9,999,999,999", "9,999,999,999", "9,999,999,999", "9,999,999,999", "$999,999.99"]
      : ["1.84M", "1.20M", "640K", "212K", "$14.20"];
  const REPOS = (w) =>
    (w
      ? [L(0), L(1), L(2), "x", L(0) + L(1), "spacevibe-api", "tinysift", "dotfiles"]
      : ["spacevibe-deck", "spacevibe-api", "spacevibe-board", "tinysift"]
    ).map((n, i) => ({
      n,
      pct: Math.max(8, 90 - i * 11),
      cost: w ? "$999,999.99" : ["$12.40", "$7.10", "$3.20", "$1.10"][i],
      tok: w ? "9,999,999,999" : ["1.1M", "420K", "190K", "60K"][i],
    }));
  const MODELS = (w) =>
    (w
      ? [L(0), "claude-opus-5-5-20261001-extended-thinking-preview", "gpt-5.5-codex-high", "x"]
      : ["Opus 5.5", "Sonnet 5.5", "gpt-5.5", "Haiku 5"]
    ).map((n, i) => ({
      n,
      pct: [58, 24, 14, 4][i],
      cost: w ? "$999,999.99" : ["$14.60", "$6.10", "$3.50", "$0.40"][i],
      tok: w ? "9,999,999,999" : ["1.0M", "520K", "250K", "70K"][i],
    }));
  const tr = (cells, head) =>
    `<div class="ov-tr ${head ? "t-meta" : ""}">${cells.map((c, i) => `<span class="${i ? "ov-num t-ellipsis t-num" : "t-ellipsis"}">${c}</span>`).join("")}</div>`;
  const usageSec = (name, body) =>
    `<section class="col gap-4">${D.sectionHead(name)}${body}</section>`;
  const allowance = (
    u,
  ) => `<div class="card pad-12 col gap-8"><div class="flex gap-8">${D.agentLogo(u.agent, 16)}<span class="t-strong grow t-ellipsis">${esc(u.label)}</span>${u.windows.some((x) => x.pct >= 90) ? D.badge("Low", { tone: "need" }) : ""}</div>
    ${u.windows.map((x) => `<div class="col gap-4"><div class="flex gap-8 t-meta"><span class="t-body">${esc(x.name)}</span><span class="t-ellipsis grow t-faint">${esc(x.resets)}</span><span class="t-num">${x.pct}%</span></div>${D.meter(x.pct, x.pct >= 100 ? "fail" : x.pct >= 80 ? "warn" : "")}</div>`).join("")}</div>`;

  const usagePage = (data, w) => {
    const n = NUMS(w);
    const totals = ["Processed tokens", "Cached input", "Uncached input", "Output", "Cache savings"]
      .map(
        (k, i) =>
          `<div class="col"><span class="t-meta">${k}</span><span class="t-strong t-ellipsis t-num">${n[i]}</span></div>`,
      )
      .join("");
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      .map(
        (d, i) =>
          `<div class="ov-day"><span class="t-meta">${d}</span>${D.meter([30, 52, 18, 76, 100, 41, 12][i], i === 4 ? "warn" : "")}<span class="ov-num t-ellipsis t-num">${w ? "$999,999.99" : "$" + [2.1, 3.6, 1.2, 5.4, 7.1, 2.9, 0.8][i].toFixed(2)}</span></div>`,
      )
      .join("");
    return `<div class="col gap-24 pad-24 ov-usage">
      <div class="flex gap-12">${D.button({ label: "Back", icon: "caretLeft", variant: "ghost", size: 28 })}<span class="t-strong">Usage</span><span class="t-meta t-ellipsis grow">This machine · history still on disk</span>${D.seg(["24h", "7d", "30d", "All"], "7d", { size: 28 })}</div>
      ${usageSec("Remaining allowance", `<div class="ov-pair">${data.usage.map(allowance).join("")}</div>`)}
      ${usageSec("Totals", `<div class="ov-totals pad-8">${totals}</div>`)}
      ${usageSec("Cost", `<div class="col gap-2">${days}</div>`)}
      ${usageSec(
        "Repos",
        `<div class="col gap-2">${REPOS(w)
          .map(
            (r) =>
              `<div class="ov-day"><span class="t-ellipsis">${esc(r.n)}</span>${D.meter(r.pct)}<span class="ov-num t-ellipsis t-num">${r.cost}</span></div>`,
          )
          .join("")}</div>`,
      )}
      ${usageSec(
        "Models",
        `<div class="col gap-2">${tr(["Model", "Cost", "Share", "Tokens"], true)}${MODELS(w)
          .map((m) => tr([esc(m.n), m.cost, m.pct + "%", m.tok]))
          .join("")}</div>`,
      )}</div>`;
  };
  const pageBed = (inner) => `<div class="win-stage rel fill">${inner}</div>`;
  OV.usage = (data, { worst }) =>
    OV.sec(
      "usage details page",
      `<div class="col gap-24">${OV.cell("details", pageBed(usagePage(data, worst)))}<div class="ov-two">
    ${OV.cell("loading", pageBed(`<div class="pad-24 col gap-12"><div class="flex gap-12">${D.button({ label: "Back", icon: "caretLeft", variant: "ghost", size: 28 })}<span class="t-strong">Usage</span></div>${D.skeleton(6)}</div>`))}
    ${OV.cell("no usage yet", pageBed(`<div class="pad-24 col gap-12"><div class="flex gap-12">${D.button({ label: "Back", icon: "caretLeft", variant: "ghost", size: 28 })}<span class="t-strong">Usage</span></div>${D.empty({ icon: "usage", text: "No usage recorded on this machine yet" })}</div>`))}</div></div>`,
    );
})();
