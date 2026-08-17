# Tauri Migration Notice — Design

Date: 2026-08-17 · Status: decided, pending user approval
Target host: **Tauri only**. The Electron host never shows this surface.
Source context: [electron migration design](2026-08-11-electron-migration-design.md)
`decided` §5 · [electron MVP plan](../plans/2026-08-11-electron-mvp.md) `building`.

## Goal

A persistent banner across the top of the stage in the Tauri build, telling the
user that this build no longer updates itself and that the new Deck must be
downloaded by hand, with one control that opens the landing page.

The reason it exists: the cutover is a clean install with no auto-update bridge
between the two hosts. Without an in-app notice, everyone on 0.12.x sits on a
build that silently stops updating forever and never learns why — the exact
silence [the migration spec §5](2026-08-11-electron-migration-design.md)
`decided` set out to end.

**Non-goals:** a data-migration path; an export/import UI; a download progress
UI; anything that installs the Electron build for the user; a second notice on
the Electron side; any change to the Tauri updater's discover → download →
install path.

## 1. What the owner decided (2026-08-17)

Four choices were taken before this document was written. They are settled
input, not options to re-open.

1. **Hardcoded, not fetched.** The text and the URL live in the bundle. No new
   network call, no manifest to host.
2. **A persistent banner on the stage**, not a toast, not a modal, not a
   relabelled toolbar button.
3. **The link points at the landing root**, `https://deck.spacevibe.dev/`.
4. **Dismissal lasts the session.** Closing the banner hides it until the app
   is launched again.

A fifth was taken after the trade-off was stated: **the notice ships enabled**,
not dormant. See §10 — the risk that comes with it is accepted, not resolved.

## 2. Hard constraint: this must not touch the updater manifest

The Electron release must never appear in the `latest.json` that the endpoints
in [`tauri.macos.conf.json`](../../src-tauri/tauri.macos.conf.json) `current`
and [`tauri.windows.conf.json`](../../src-tauri/tauri.windows.conf.json)
`current` serve. If it did, every deployed Tauri client would see an available
update, download a bundle it cannot install, and land in the real
`download-failed` / `install-failed` phases of
[`update-controller.ts`](../../src/updater/update-controller.ts) `current` on
users' machines.

That rules out reusing the updater as the announcement channel and is why this
surface exists as its own thing. **No file under `src-tauri/` and no workflow
step changes.**

## 3. The constant

One module holds everything that could ever need to change:

```ts
// src/updater/migration-notice.ts
export const MIGRATION_NOTICE_ENABLED = true;
export const MIGRATION_NOTICE_URL = "https://deck.spacevibe.dev/";
```

This follows the [`GRAB_PASTE_DISABLED`](../../src/browser/browser-store.ts)
`current` precedent: one boolean is the whole switch, so turning the notice off
again is a one-line revert rather than an excavation.

The URL is the landing **root** on purpose. Once the build ships, the URL is
frozen in every copy of it — but the page behind that URL is not. That page is
the only remaining place to change what the user is told, and it is also where
the clean-install explanation and the old store path belong (migration spec §5
requires that doc page independently of this work).

## 4. Placement: below the tab strip, not above it

The banner is the first row of the stage's own content, **beneath**
`.stage__strip` and above the terminal grid.

This is an amendment to the mockup that was approved, which drew the banner
above the tabs. The reason: since 2026-08-16, hiding the sidebar moves the
traffic-light inset onto the stage strip, and the strip sits at `top: 0`.
Anything placed above it on macOS would render underneath OS-painted window
buttons.

Mechanically, [`06-stage-panes.css`](../../src/styles/06-stage-panes.css)
`current` already offsets the pane grid for the strip
(`.stage--strip .stage__tabs { top: var(--frame-h) }`). The banner adds a
second modifier in the same shape — `.stage--notice`, offsetting by a new
`--notice-h` token, and both together when the strip is present. On Tauri the
stage carries only the strip and the terminal grid (the file surface and the
browser are Electron-only), so `.stage__tabs` is the only offset target.

The shell grid in [`02-shell.css`](../../src/styles/02-shell.css) `current` is
**not** touched. Its three rows and the explicit `grid-row` placements that
depend on them (`.deck-frame` on row 1, `.window--sidebar > .stage` spanning
`1 / 3`) are load-bearing, and inserting a fourth row would move every one of
them.

Both layouts get the banner: top-tab mode and sidebar mode alike. Because it
lives inside the stage rather than the shell, neither layout needs its own
placement rule.

## 5. Dismissal

A window-scoped signal, per R5. No settings key is added and nothing is
persisted — relaunching brings the banner back.

**Consequence, accepted:** module stores are window-scoped, so a user with two
Deck windows dismisses twice. For a notice whose whole job is to be seen, a
dismissal that does not travel between windows errs in the safe direction.

## 6. Host gating

The banner renders only when the Tauri host is present, using the same
`__TAURI_INTERNALS__` probe that
[`tauri-updater-adapter.ts`](../../src/updater/tauri-updater-adapter.ts)
`current` already uses. The Electron host must never tell a user to leave
Electron, and the browser-only `npm run dev` preview is not a build anyone
installs.

Because the probe is a runtime check rather than a build flag, the same
renderer bundle serves both hosts — no change to how either is built.

## 7. Modules and seams

| File                              | State  | Responsibility                                                                       |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `src/updater/migration-notice.ts` | new    | the two constants, plus a pure `shouldShowNotice(...)` taking host + dismissed state |
| `src/ui/migration-banner.tsx`     | new    | the row: message, one action, one close control                                      |
| `src/styles/06-stage-panes.css`   | edited | `.stage--notice` offset and the banner's own rules                                   |
| `src/ui/app.tsx`                  | edited | mounts the banner inside the stage and owns the dismissed signal                     |
| `docs/DESIGN-LANGUAGE.md`         | edited | new §30 (see §8)                                                                     |

No R4 seam is involved. The updater controller, tab materialization, PTY
ownership, the window coordinator and close/quit coordination are all
untouched; the banner reads no updater state and calls nothing on it.

`shouldShowNotice` is a pure function so the decision is testable without
mounting anything: enabled × host × dismissed is three booleans and eight
cases, and the one that matters (Electron host, enabled, not dismissed → false)
is the one a rendering test would be worst at proving.

## 8. Design language: a new §30

The banner is a genre no existing rule reaches. §11 covers full-window screens,
§13 anchored popovers, §19 docked side panels, §29 modals — none describes a
persistent horizontal notice the app raises and the user cannot make
permanently go away. §30 is the next free number above §29 (§22 stays
reserved).

The rule must fix at least: that there is exactly one such surface and it is
reserved for something the user must act on outside the app; that its colour
comes from a §3 role rather than a new one; that it carries `role="status"`;
that it costs the stage height rather than floating over the panes; and that
its close control uses the neutral hover wash, matching the tab strip's rather
than the rail's red.

## 9. Copy

Two lines, sentence-case per DL §8:

- **Message:** "This build no longer updates itself. The new Deck must be
  downloaded by hand, and settings do not carry over."
- **Action:** "Open the download page" — not "Get the new Deck". DL-8 says a
  control says what happens, and what happens is that a browser tab opens; the
  download is a decision the user makes on the page.
- **Close:** an unlabelled `✕` with an accessible name of "Hide this notice
  until Deck restarts" — the label has to say that the dismissal is temporary,
  because the control otherwise reads as "never show me this again".

The mention of settings not carrying over is deliberate: it is the single fact
most likely to make a user delay the move, and finding it out after the fact is
worse than reading it here.

## 10. Risk accepted: the notice ships enabled

The sentence "this build no longer updates itself" is false on any Tauri
release tagged before the Electron build is downloadable. `AGENTS.md` keeps
Tauri open for hotfixes and release support, so such a release is possible.

The alternative — defaulting the constant to `false` and flipping it as the
deliberate act that makes a release the final one — was offered and declined.
Two conditions therefore attach to the decision, and they are release
discipline rather than code:

1. The landing page must say something true about the new build **before** the
   next Tauri tag, not after it.
2. Any Tauri hotfix tagged before then ships the notice with it. If that is not
   wanted, the constant is set to `false` for that build — one line.

## 11. Verification

This feature inverts the repo's usual evidence gap. Almost every recent landing
is renderer-only, reaches both hosts, and is verified under Electron. Here the
**target** host is Tauri, whose stage-strip behaviour `AGENTS.md` currently
records as unverified.

Required before the claim is made:

- `npm test` — including new unit tests for `shouldShowNotice` and the banner.
- `npm run build`.
- A native pass under `npm run tauri dev`: the banner appears in both layouts,
  the action opens the landing page in the default browser, `✕` hides it, and
  relaunching brings it back.
- A pass under `npm run electron:dev` proving the banner does **not** appear.
- Owner eye review on a rendered screenshot, per DL §9.6.

A green suite and a green bundle are not evidence for any of the last three.

## 12. Forks recorded

- **This upgrades a frozen decision.** Migration spec §5 specified a final
  release's _notes_ plus a doc page, and stated "Neither is code". An in-app
  surface is code. The owner asked for it on 2026-08-17.
- **A new rule in `docs/DESIGN-LANGUAGE.md`** (§30), which `AGENTS.md` lists as
  a fork by name.
- **Release-adjacent, but not release-configuration.** No updater endpoint,
  channel, signing input or workflow step changes. The fork is recorded because
  the surface exists to announce a channel retirement, not because it
  configures one.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim                                    | Intent    | Status  | Evidence                                            |
| ---------------------------------------- | --------- | ------- | --------------------------------------------------- |
| The migration notice reaches Tauri users | `decided` | backlog | This document only; no code exists as of 2026-08-17 |
