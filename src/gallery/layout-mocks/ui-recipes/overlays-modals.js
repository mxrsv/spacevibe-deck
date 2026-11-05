/* =====================================================================================
   overlays-modals.js: Overlays tab, part 2 of 3 (modals, --elev-3 over the scrim).
   Mirrors project-rail-remove-dialog.tsx, create-entry-dialog.tsx, preset-editor.tsx,
   save-preset-dialog.tsx, usage-consent-modal.tsx. Needs overlays.js (window.OV) loaded first.
   ===================================================================================== */
(function () {
  "use strict";
  const D = window.Deck;
  const OV = window.OV;
  const { esc } = D;
  const modalBed = (modal, cap, o = {}) => OV.cell(cap, OV.bed(modal, o), o.wide ? "ov-wide" : "");
  const foot = (...b) => `<div class="modal-foot">${b.join("")}</div>`;
  const title = (t) => `<span class="t-dialog t-wrap">${esc(t)}</span>`;

  const remove = (
    name,
    tabs,
  ) => `<div class="modal" role="dialog" aria-label="Remove project"><div class="col gap-8">${title(`Remove ${name}?`)}
    <p class="t-body t-muted t-wrap">${tabs === 0 ? "Nothing is open in it. It only leaves the rail." : `Closes ${tabs} ${tabs === 1 ? "tab" : "tabs"} and takes the project off the rail.`}</p></div>
    ${foot(D.button({ label: "Cancel" }), D.button({ label: "Remove", variant: "danger" }))}</div>`;

  // checkEntryName: empty keeps Create off with no message; a bad name shows its reason.
  const createFile = ({
    value = "",
    error,
    dest,
    kind = "file",
  }) => `<div class="modal" role="dialog" aria-label="New ${kind}"><div class="col gap-4">${title(kind === "file" ? "New file" : "New folder")}
    <span class="t-meta t-wrap">in ${esc(dest)}</span></div>
    <div class="form-field">${D.field({ placeholder: kind === "file" ? "File name" : "Folder name", value, state: "focus", error: Boolean(error), label: "Name" })}
    ${error ? `<span class="note-line is-fail">${D.icon("alertCircle", 12)}${esc(error)}</span>` : ""}</div>
    ${foot(D.button({ label: "Cancel" }), D.button({ label: "Create", variant: "primary", state: value && !error ? "" : "disabled" }))}</div>`;

  const presetEditor = (data, w, nameValue) => {
    const paneBox = (n, cwd, active) =>
      `<div class="pane ${active ? "is-active" : ""} grow"><div class="pane-head">${D.icon(cwd ? "folder" : "back", 14)}<span class="t-ellipsis grow">${esc(cwd || "inherit")}</span><span>pane ${n}</span></div><pre class="term"><span class="mu">${cwd ? "" : "uses the tab folder"}</span></pre></div>`;
    return `<div class="modal" role="dialog" aria-label="New layout preset" style="--modal-w:calc(var(--popover-w) * 2)">
      <div class="flex gap-8">${D.icon("grid", 16, "ico-muted")}<span class="t-dialog grow">New layout preset</span>
        ${D.iconButton({ icon: "split", label: "Split right" })}${D.iconButton({ icon: "minus", label: "Split down" })}${D.iconButton({ icon: "trash", label: "Remove pane" })}${D.button({ label: "Set CWD", icon: "folder", size: 28 })}</div>
      <div class="flex stretch gap-4" style="height:calc(var(--row-44) * 4)">${paneBox(1, w ? OV.long(0) : "~/Development/spacevibe-deck", true)}<div class="col gap-4 grow">${paneBox(2, null)}${paneBox(3, "~/Development/spacevibe-api")}</div></div>
      <div class="flex gap-8">${D.field({ placeholder: "Preset name", value: nameValue, cls: "grow", label: "Preset name" })}<span class="t-meta">3 panes</span>${D.button({ label: "Cancel" })}${D.button({ label: "Create", variant: "primary", state: nameValue ? "" : "disabled" })}</div></div>`;
  };

  const savePreset = (
    data,
    w,
    { name = "", pick = null },
  ) => `<div class="modal" role="dialog" aria-label="Save layout as preset">${title("Save layout as preset")}
    <div class="form"><div class="form-field"><span class="field-label">Save as new</span>${D.field({ placeholder: "Preset name", value: name, state: pick ? "" : "focus", label: "Preset name" })}</div>
    <div class="form-field"><span class="field-label">Or overwrite</span>${D.select({ value: pick || "—" })}</div>
    <label class="flex gap-8">${D.check(true, { label: "Include per-pane folders" })}Include per-pane folders</label></div>
    ${foot(D.button({ label: "Cancel" }), D.button({ label: "Save", variant: "primary", state: name || pick ? "" : "disabled" }))}</div>`;

  const consent = (
    busy,
  ) => `<div class="modal" role="dialog" aria-label="Usage stats">${title("Help improve Deck")}
    <p class="t-body t-muted">Share optional usage stats. No code, paths or prompts, and you can change your answer any time in Settings → Privacy.</p>
    <span class="flex">${D.chip({ label: "What Deck sends", end: D.icon("external", 12) })}</span>
    ${busy ? `<span class="note-line">${D.icon("loader", 12, "spin")}Saving your choice…</span>` : ""}
    ${foot(D.button({ label: "Not now", state: busy ? "disabled" : "" }), D.button({ label: "Share usage stats", variant: "primary", state: busy ? "disabled" : "" }))}</div>`;

  OV.modals = (data, { worst }) => {
    const w = worst;
    const pre = data.presets[0];
    return OV.sec(
      "modals  --elev-3 over the scrim",
      `<div class="ov-two">${[
        modalBed(remove(w ? OV.long(0) : "spacevibe-deck", 3), "remove project, live"),
        modalBed(remove(w ? OV.long(1) : "tinysift", 0), "remove project, remembered"),
        modalBed(
          createFile({ dest: w ? "spacevibe-deck/" + OV.long(0) : "spacevibe-deck/src/ui" }),
          "create file, empty",
        ),
        modalBed(
          createFile({
            value: w ? OV.long(0) + ".tsx" : "launcher-menu.tsx",
            dest: "spacevibe-deck/src/ui",
          }),
          "create file, valid name",
        ),
        modalBed(
          createFile({
            value: "ui/menu.tsx",
            error: "A name cannot contain a path separator",
            dest: "spacevibe-deck/src/ui",
          }),
          "create file, invalid name",
        ),
        modalBed(
          createFile({ kind: "folder", value: "components", dest: "spacevibe-deck/src" }),
          "create folder",
        ),
        modalBed(presetEditor(data, w, ""), "preset editor, no name", { rows: 11, wide: true }),
        modalBed(
          presetEditor(data, w, w ? OV.long(1) : "Claude + Codex pair"),
          "preset editor, named",
          { rows: 11, wide: true },
        ),
        modalBed(
          savePreset(data, w, { name: w ? OV.long(0) : "Review layout" }),
          "save preset, new name",
        ),
        modalBed(savePreset(data, w, { pick: pre.name }), "save preset, overwrite"),
        modalBed(consent(false), "usage consent"),
        modalBed(consent(true), "usage consent, saving"),
      ].join("")}</div>`,
    );
  };
})();
