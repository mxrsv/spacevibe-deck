# Deck-wide shadcn and Base UI migration

Date: 2026-10-21
Status: Direction and whole-app scope approved in conversation; implementation and visual
acceptance remain open. This specification does not claim shipped behavior.

## Authority and scope

The owner chose Base UI, the shadcn preset `b1a09kDGF`, and a large refactor of the entire
Deck application UI. Migrated components must use the preset's upstream shadcn styling, not
reproduce Deck's existing CSS token system.

Delivery (owner, 2026-10-24, superseding "waves in an isolated worktree"): work lands on
`main` region by region in small PRs, each new region behind a switch that is off outside dev
builds, so the old surface stays the default and `main` stays releasable. Blocks that several
regions share are extracted into one set before parallel tracks start; a region cuts over only
after the owner's eye review against the reference mock, and that change deletes the old
version and the region's switch.

This is the canonical specification for component technology, appearance and migration
boundaries across the app. It supersedes the Settings-only base-component direction in
[the Settings and theme specification](2026-10-17-settings-theme-overhaul.md), including
"Deck density", 28px controls, the Deck-token Tailwind map, and the Radix-first proposal.
That specification continues to own Settings product requirements. It does not require
implementing every unshipped theme, notification or per-project feature during this refactor.

The product remains an Electron desktop terminal for running agent CLIs side by side.
The UI is an operating surface: preserve real content, keyboard workflows, state honesty,
and accessible names. This is not a landing-page redesign. Marketing is outside this scope.

## Reference configuration

The owner supplied `pnpm dlx shadcn@latest init --preset b1a09kDGF --template next` and
then confirmed Base UI. Use the preset; do not convert Deck to Next.js or switch its package
manager. Explicitly select `base`, not `aria` or `radix`.

`shadcn@4.22.1 preset decode b1a09kDGF --json` resolves to:

| Setting               | Value                                     |
| --------------------- | ----------------------------------------- |
| Style                 | Mira                                      |
| Base color            | Stone                                     |
| Theme and chart color | Blue                                      |
| Font                  | Inter                                     |
| Heading font          | Inherit                                   |
| Icons                 | Hugeicons                                 |
| Radius                | Medium                                    |
| Menu color            | Inverted translucent                      |
| Menu accent           | Subtle                                    |
| Component base        | Base UI, explicitly selected by the owner |

Reference: [preset](https://ui.shadcn.com/create?preset=b1a09kDGF),
[CLI](https://ui.shadcn.com/docs/cli). Pin the generator and installed dependency versions
in implementation evidence; do not silently re-resolve `latest` between waves.

## Requirements

- **UI-1 Upstream source.** Generate/copy the selected preset's official component source.
  Keep its variants, sizing, spacing, typography, colors, border, radius, shadow and state
  treatment. Adapt imports, renderer types, asset paths and portal integration only where
  required by Deck, recording each adaptation. Do not hand-draw a "shadcn-like" replacement.
- **UI-2 Independent tokens.** Migrated UI reads the preset's own light/dark tokens. Never
  alias those values to `--bg`, `--fg`, `--text-*`, `--chrome-*`, Deck's radius/type scales,
  or colors derived from a terminal palette. Namespacing to prevent collisions is allowed;
  changing the resulting preset appearance is not. Terminal ANSI and editor syntax colors
  are separate content concerns and retain their stored values and behavior.
- **UI-3 Controlled coexistence.** Before a surface moves, it keeps its existing appearance
  and behavior. No global reset, selector or colliding variable may restyle it accidentally.
  A migrated surface and its portals must use the same preset, mode, font and reset rules;
  legacy `.cfg-*`, modal and context selectors must not override it. A scoped reset must
  reproduce the upstream component's computed result, not become a substitute Deck theme.
- **UI-4 One component definition.** Shared primitives live in `src/ui/controls/`, which
  already owns controls. Compose product-specific controls from those primitives. Callers
  select upstream variants and sizes; they do not recreate control colors or geometry.
  Layout-only composition is allowed. No parallel Button/Switch/Dialog implementation for
  each feature, and no new generic `utils.ts` file for class composition. The shared set may
  be narrowed to the sizes and variants Deck's surfaces use, each with one documented role.
  Narrowing removes options and never alters the computed result of one that stays, so UI-1
  still holds for every kept option.
- **UI-5 Runtime compatibility.** Keep Electron, Vite, Preact and signals unless a separate
  architecture decision approves a change. Base UI must work through the real renderer
  boundary, not only a React demo. A failed compatibility gate does not authorize replacing
  Base UI with Radix, porting the app to React, or accumulating unreviewed compatibility shims.
- **UI-6 Behaviors survive.** Preserve settings writes and unreadable-store locks, page/row
  deep links, shortcut recording, disabled and invalid states, drafts, confirmations,
  permissions, focus restoration and pending/error feedback. Preserve native dragging,
  resize affordances, terminal input and terminal escape handling behind overlays.
- **UI-7 Accessibility.** Controls have names, roles and state; keyboard-only operation,
  visible focus, reduced motion, disabled semantics and error association remain mandatory.
  Verify overlay focus trap/return, nested dismissal, pointer outside and IME composition.
  Adopting a library is not evidence that Deck's composition satisfies these requirements.
- **UI-8 Wave completion.** Every wave includes its actual consumers, deletion of the old
  rules no longer used, relevant tests and documentation, a real-component visual specimen,
  and recorded checks. A test/count ratchet prevents new legacy controls on migrated surfaces.
  Do not claim a whole surface migrated while raw controls or legacy skin remain there.
- **UI-9 Whole-app inventory.** Cover Settings, shared overlays/forms, workspace entry and
  launcher, prompts/presets, rail/space/tab chrome, dock and Usage, Explorer/Changes/editor and
  browser chrome, notifications/toasts, account/update/help surfaces and remaining mounted
  application UI. Inventory both direct and indirect consumers, including exceptional windows.
  xterm and Monaco internals and OS-owned menus/dialogs are not rewritten; their surrounding
  Deck UI is included. Retired gallery/Agent Board demos are not shipping acceptance targets.
- **UI-10 Assets.** Use the preset's Inter and Hugeicons for migrated chrome. Bundle required
  font assets locally for offline `file://` use. Keep application/agent brand marks and terminal
  fonts; do not invent replacement logos. Old Phosphor consumers may coexist until their wave.
- **UI-11 Default appearance is testable.** Compare the same generated component and states
  in an isolated reference and inside Deck. A mismatch caused by legacy CSS fails the wave.
  Product composition can differ from a documentation example; the controls' style cannot.

## Settings and theme boundary

### Gallery pilot (owner request, 2026-10-21)

Before production migration, the owner requested a broad gallery preview of Deck with the
selected shadcn/Tailwind system. The [registered specimen](../../src/gallery/sections/shadcn-deck-section.tsx)
embeds an isolated document with its own upstream reset, tokens, fonts and portals. It shows
Workbench, Settings, Usage and Changes with launcher/menu interactions and light/dark modes.
Data is illustrative and local to the preview; no host, persistent settings or agent runs.
The shared controls are real generated components; surrounding screens are proposed gallery
compositions, not the migrated production screens. Gallery acceptance does not satisfy AC-2,
AC-4 or the whole-app migration gate. The pilot's Settings navigation is not an approved
direction: Command (SET-2) remains the target, and no pilot layout is promoted as the Settings
structure. Composites the pilot builds by hand are proposals, not shared component definitions
under UI-4.

### Production boundary

Settings migrates by replacement, not in place (owner, 2026-10-24): the Command Settings of
the layout mock is built directly behind its switch, and the existing Settings screen is not
first moved onto the shared controls, because Command would replace that work. All mounted
categories, account states and compound editors must be covered, not just Appearance. Its real
stores, search and reset contracts come from the existing Settings specification; the
gallery's in-memory model must never become production data. Preserve
`openSettingsAt(page, key)` through the transition. Until Command cuts over, the existing
Settings screen keeps its current controls; only CSS no consumer still uses may be deleted.

The old theme overhaul's custom chrome token editor and replacement theme palette cannot
override this preset during migration. Those unimplemented product features are deferred to
their owning specification. Do not delete stored theme IDs, imported files, terminal colors,
editor colors or preference keys to accomplish a visual refactor. Derive the initial preset
light/dark mode from the active theme's type without rewriting the theme selection. A future
independent chrome-mode preference or data migration needs its own product decision.

## Approved forks and hard stops

The owner's 2026-10-21 decisions authorize Base UI and the dependencies generated for the
chosen preset, and replacement of the old visual language on migrated UI: token/color roles,
font/type/radius/spacing scales, Hugeicons, stock shadows/translucency, transitions and custom
selects. Rewrite the affected portions of `docs/DESIGN-LANGUAGE.md` and their policy checks
with the implementation; keep rule numbers and unaffected behavioral constraints intact.
Do not waive all policies globally. Name each exception by migration boundary and remove
obsolete legacy policy only after its last consumer has moved.

Not authorized by this visual refactor: replacing Preact/signals, altering PTY ownership,
process classification, coordinator/tab materialization/layout-engine/close contracts,
changing IPC or stored data shapes, signing/updater/release configuration, sibling repos,
deploying, pushing or merging. A necessary change in one of these areas stops that wave for
a concrete owner decision; independent authorized work may continue.

## Acceptance criteria

| ID   | Required evidence                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Generator version, decoded preset and dependency versions recorded; generated source and allowed adaptations traceable.                                                                                                                                                     |
| AC-2 | Base UI controls/overlays pass Preact compatibility tests, then an isolated Electron walk including packaged `file://`, portal focus/return, nested dismissal, IME and a terminal behind the overlay. No second React renderer in the bundle.                               |
| AC-3 | Light/dark preset components match the reference inside Deck, including portalled states; the owner has reviewed screenshots or recording. Unmigrated surfaces have no measured style leakage.                                                                              |
| AC-4 | Existing Settings values, writes, reset scopes, search/deep links, agent editors, shortcuts, account and failure states still work. Command additionally satisfies the retained Settings navigation requirements.                                                           |
| AC-5 | Each mounted UI surface in the inventory has a completed wave or an explicit technical exclusion; all shipping legacy control skins are removed at final acceptance.                                                                                                        |
| AC-6 | Tests beside changed files, typecheck, changed-file lint/format and `scripts/` + `src/styles/` policy suites pass, or failures are isolated against the recorded baseline without claiming a pass. Build/native checks are recorded when run; unrun checks remain explicit. |
| AC-7 | No user data migration/loss, no PTY/IPC/lifecycle behavior change, no remote font dependency, no altered sibling repo; affected docs and policy anchors agree with shipped behavior.                                                                                        |

The local execution checklist remains the existing
`docs/plans/2026-10-19-tailwind-strangler-migration.md` in the primary checkout. It is ignored,
not available from a fresh clone. This committed spec is the durable requirements record.
Visual acceptance and merge authorization are separate from successful implementation tests.
