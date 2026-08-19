# Automatic Terminal Renderer Implementation Plan

**Decision source**: Owner-approved conversation on 2026-08-19
**Goal**: Make every terminal pane attempt WebGL automatically and fall back to DOM without exposing a renderer preference.
**Architecture**: Renderer selection becomes a pane lifecycle concern rather than persisted user state. Each pane activates one `WebglAddon` only after `Terminal.open()`; initialization failure or context loss disposes that addon, records the fallback, and leaves xterm's DOM renderer active without restarting the pane or PTY.

## 1. Expected outcomes

- Every newly mounted pane attempts WebGL after xterm has opened — verify with `loads WebGL only after the terminal is open` in [`pane-renderer.test.ts`](../../src/terminal/pane-renderer.test.ts).
- A WebGL initialization failure leaves the pane usable on DOM and emits diagnostic context — verify with `falls back to DOM and warns when WebGL cannot initialize` in [`pane-renderer.test.ts`](../../src/terminal/pane-renderer.test.ts).
- A lost WebGL context is disposed exactly once and the pane remains on DOM — verify with `falls back to DOM and warns on context loss` in [`pane-renderer.test.ts`](../../src/terminal/pane-renderer.test.ts).
- Renderer choice is absent from persisted settings and the Settings surface — verify with [`settings-schema.test.ts`](../../src/settings/settings-schema.test.ts), [`settings-screen.test.tsx`](../../src/ui/settings/settings-screen.test.tsx), and `rg -n 'terminalRenderer|TERMINAL_RENDERERS|TerminalRenderer' src` returning no matches.
- OpenCode's block and box glyphs render through xterm's custom-glyph path whenever WebGL is available — verify in both native hosts with an owner-approved manual run.

## 2. Canonical state

**Canonical behavior**: [`pane.ts`](../../src/terminal/pane.ts) owns automatic renderer activation and fallback for every pane.

**Read from**: xterm's successful `WebglAddon` activation and `onContextLoss` event.

**Do not read from**: persisted settings, agent identity, `TERM_PROGRAM`, OpenCode output, pane focus, or tab visibility. Those inputs either make the behavior user-dependent, couple Deck to one TUI, or introduce live DOM/WebGL swaps that can reflow the text grid.

## 3. Rules and invariants

- **WebGL first**: each pane attempts WebGL exactly once during its first `mount()`, after `Terminal.open()` — verify with `loads one WebGL addon across repeated mounts`.
- **DOM fallback**: activation failure and context loss must not escape into pane or PTY lifecycle code — verify with the two fallback tests in [`pane-renderer.test.ts`](../../src/terminal/pane-renderer.test.ts).
- **Explicit failure handling**: both fallback paths emit one `console.warn` with enough context to distinguish initialization failure from context loss — verify by spying on `console.warn` in the fallback tests.
- **No live renderer switching**: `applySettings()` never creates or disposes a renderer addon — verify with `does not change the renderer when settings are applied`.
- **One GPU owner**: a live pane holds at most one `WebglAddon`, and `dispose()` releases it explicitly — verify with `loads one WebGL addon across repeated mounts` and `dispose releases the active WebGL addon`.
- **Shared renderer path**: no Electron or Tauri host code changes; both hosts receive the behavior through the shared renderer — verify by keeping changes under `src/` and running the native checks separately.

## 4. Scope

**In scope**:

- Remove `terminalRenderer` from the settings type, defaults, validation, Settings UI, and gallery specimen.
- Activate WebGL automatically for every mounted pane.
- Fall back to DOM on initialization failure or context loss without restarting the pane.
- Add targeted lifecycle, schema, and Settings-surface tests.
- Update architecture, working context, and public renderer documentation.
- Run automated checks and, only with explicit permission, native macOS checks on both hosts.

**Out of scope**:

- Detecting OpenCode or any other agent before choosing a renderer.
- Switching renderers on pane focus, tab visibility, or output content.
- Pooling or capping WebGL contexts before native measurements show a real limit.
- Retrying WebGL inside a pane after context loss.
- Changing terminal font, `lineHeight`, PTY environment, xterm versions, or dependencies.
- Claiming Windows behavior without real Windows hardware evidence.

## 5. Accepted risks

- WebGL text rasterization becomes the normal path for every pane, so existing users may notice different antialiasing or integer device-pixel cell widths.
- A machine with unavailable or unstable WebGL receives DOM rendering and therefore may still show segmented OpenCode glyphs; the pane remains usable and the fallback is diagnosable in logs.
- Deck currently keeps hidden panes mounted. This plan does not reduce their WebGL context count because focus-driven renderer swaps can visibly reflow xterm's grid; context pooling remains a measurement-led follow-up.
- Legacy `terminalRenderer` keys may remain in an old host-side JSON object until a full settings write, but `validateSettings()` ignores them immediately and they no longer affect runtime behavior.

There are no open product or architecture decisions for implementation.

## 6. Tasks

### Task 1: Remove renderer choice from the settings contract

**Files**:

- [`settings-schema.ts`](../../src/settings/settings-schema.ts)
- [`settings-schema.test.ts`](../../src/settings/settings-schema.test.ts)

**Estimate**: 5–10 minutes

**Decision**: Renderer selection is no longer persisted or user-configurable; legacy stored keys are ignored.

**Build**:

- Remove `TerminalRenderer`, `TERMINAL_RENDERERS`, `Settings.terminalRenderer`, its default, its validator, and its `validateSettings()` output field.
- Replace the renderer-choice schema tests with a regression proving legacy `dom`, `webgl`, and malformed values do not survive validation as a settings property.
- Keep unknown-key handling generic; do not add a renderer-specific migration or settings version.

**Verify**:

- `npm test -- src/settings/settings-schema.test.ts` exits `0`.
- Test `ignores legacy terminalRenderer values` passes for `dom`, `webgl`, and an invalid value.

---

### Task 2: Make WebGL activation automatic and one-shot

**Files**:

- [`pane.ts`](../../src/terminal/pane.ts)
- [`pane-renderer.test.ts`](../../src/terminal/pane-renderer.test.ts)

**Depends on**: Task 1

**Estimate**: 10 minutes

**Decision**: Every pane attempts one WebGL activation after `Terminal.open()` and stays on DOM after any fallback.

**Build**:

- Remove the renderer type import, closure state, and settings-driven reconciliation from `pane.ts`.
- Replace `syncRenderer()` with `activateWebglRenderer()`, called only inside the first-mount branch after `Terminal.open()`.
- Preserve the active addon handle so pane disposal releases the GPU context explicitly.
- On activation failure, dispose the partially activated addon, clear the handle, and emit one initialization-fallback warning containing the thrown error.
- On context loss, dispose the active addon, clear the handle with the existing identity guard, and emit one context-loss fallback warning.
- Remove renderer work from `applySettings()`; font, theme, scrollback, and fit behavior remain unchanged.
- Rewrite renderer tests around default settings and automatic behavior; delete live DOM/WebGL switching cases.

**Verify**:

- `npm test -- src/terminal/pane-renderer.test.ts` exits `0`.
- Tests `loads WebGL only after the terminal is open`, `loads one WebGL addon across repeated mounts`, `falls back to DOM and warns when WebGL cannot initialize`, `falls back to DOM and warns on context loss`, `does not change the renderer when settings are applied`, and `dispose releases the active WebGL addon` pass.

---

### Task 3: Remove the renderer control from Settings

**Files**:

- [`appearance-section.tsx`](../../src/ui/settings/sections/appearance-section.tsx)
- [`settings-screen.test.tsx`](../../src/ui/settings/settings-screen.test.tsx)

**Depends on**: Task 1

**Estimate**: 5 minutes

**Decision**: Settings exposes no renderer selector or fallback status.

**Build**:

- Remove the renderer imports, cycling callback, explanatory comment, and `Terminal renderer` row from the Appearance section.
- Keep the `Repeat` icon used by the independent tab-bar-position control.
- Remove `Terminal renderer` from the hand-authored expected Settings-row inventory.

**Verify**:

- `npm test -- src/ui/settings/settings-screen.test.tsx` exits `0`.
- The expected-row test still accounts for every remaining Settings row exactly once.

---

### Task 4: Align the visual specimen with the shipping Settings surface

**Files**:

- [`settings-direction.tsx`](../../src/gallery/sections/settings-direction.tsx)

**Depends on**: Task 3

**Estimate**: 2–5 minutes

**Decision**: The parked Settings specimen must not advertise a control the app no longer ships.

**Build**:

- Remove the `Terminal renderer` specimen row.
- Remove the `Repeat` import if the deleted row is its last use in this file.
- Do not add a replacement status row or alter surrounding layout and styles.

**Verify**:

- `rg -n 'Terminal renderer|WebGL joins block glyphs' src/gallery/sections/settings-direction.tsx` returns no matches.
- `npm run build` reports no unused import or type error from the specimen change.

---

### Task 5: Update architecture and public behavior documentation

**Files**:

- [`ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`README.md`](../../README.md)

**Depends on**: Tasks 1–4

**Estimate**: 10 minutes

**Decision**: Documentation describes WebGL-first automatic activation, DOM fallback, and the absence of a renderer preference.

**Build**:

- Rewrite the renderer bullets in `ARCHITECTURE.md` around `activateWebglRenderer()`, its one-shot lifecycle, explicit disposal, and shared-host boundary.
- Add a concise renderer note to the xterm entry in `README.md`: WebGL custom glyphs are attempted automatically and DOM remains the compatibility fallback.

**Verify**:

- `rg -n 'terminalRenderer|TERMINAL_RENDERERS|TerminalRenderer' src docs/ARCHITECTURE.md README.md` returns no matches.
- Every behavioral claim added to `ARCHITECTURE.md` has a relative source link and an intent label.

---

### Task 6: Run automated verification

**Files**:

- No source files.

**Depends on**: Tasks 1–5

**Estimate**: 10 minutes

**Decision**: Targeted tests, the repository suite, and both TypeScript build paths are the automated evidence gate.

**Build**:

- Run the three targeted suites first, then the repository suite and production renderer build.
- Run the Electron main-process build separately so renderer type changes cannot leave its imports stale.
- Record exact exit codes and test counts for Task 8; do not convert a pre-existing failure into a pass claim.

**Verify**:

- `npm test -- src/settings/settings-schema.test.ts src/terminal/pane-renderer.test.ts src/ui/settings/settings-screen.test.tsx` exits `0`.
- `npm test` exits `0` with the final passed-test count recorded.
- `npm run build` exits `0`.
- `npm run electron:build` exits `0`.
- `rg -n 'terminalRenderer|TERMINAL_RENDERERS|TerminalRenderer' src` returns no matches.

---

### Task 7: Run native visual acceptance on both hosts

**Files**:

- No source files.

**Depends on**: Task 6

**Estimate**: 5–10 minutes per host

**Decision**: Electron and Tauri require separate macOS evidence; native commands remain permission-gated.

**Build**:

- Do not launch either native host without explicit permission.
- With permission, open OpenCode in Electron, confirm its wordmark and prompt borders have no segmented cells, exercise ordinary Settings interactions, and confirm the renderer row is absent.
- Repeat the same check under Tauri; do not reuse the Electron observation as Tauri proof.
- Record the host, OS, result, and owner eye-review status separately; leave Windows unverified.

**Verify**:

- Owner-approved `npm run electron:dev` check records whether OpenCode glyphs and Settings removal pass on native macOS.
- Owner-approved `npm run tauri dev` check records the same evidence independently; no Electron result is reused as Tauri proof.

---

### Task 8: Close the working-context record

**Files**:

- [`CONTEXT.md`](../CONTEXT.md)

**Depends on**: Tasks 6–7

**Estimate**: 5 minutes

**Decision**: Working context distinguishes automated evidence, native evidence, owner eye approval, and unverified platforms.

**Build**:

- Replace the planning state with the implemented behavior and source anchors.
- Record exact automated commands, exit codes, and test counts from Task 6.
- Record each native result from Task 7, or explicitly state that the permission-gated run was deferred and remains unverified.
- Keep the `Chưa khớp thực tế` ledger intact; add a row only if implementation evidence contradicts an existing `current` claim.

**Verify**:

- Every behavioral claim added to `CONTEXT.md` has a relative source link and an intent label.
- `CONTEXT.md` still ends with its `Chưa khớp thực tế` section.
- No deferred native or Windows check is described as passed.

## 7. Self-review

- The plan covers the confirmed behavior: unconditional automatic selection, no renderer UI, WebGL-first activation, and DOM fallback.
- Failure modes map to concrete tests: initialization failure, context loss, repeated mount, settings application, and disposal.
- Every implementation symbol introduced by the plan is defined here; later tasks consistently refer to `activateWebglRenderer()`.
- No task changes PTY ownership, process classification, dependencies, xterm versions, release configuration, or a design-language rule.
- Native runs remain permission-gated and Windows remains explicitly unverified.
- Documentation records evidence only after the command or manual check that produced it.
- No placeholders or unspecified error-handling steps remain.
