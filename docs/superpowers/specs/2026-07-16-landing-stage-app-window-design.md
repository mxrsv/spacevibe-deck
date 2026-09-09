# Landing Hero Stage — App Window Mock Redesign

Status: implemented 2026-07-17 (plan: docs/plans/2026-07-17-landing-stage-app-window.md)
Date: 2026-07-16

## Goal

Replace the stylized hero stage in the landing prototype (direction A) with a
mock that mirrors the real released app window, so visitors see the actual
product instead of an invented marketing frame. Visual reference: the user's
screenshot of Stackgrid v0.6.x running with 3 panes, sidebar mode, Tokyo Night.
That screenshot lives only in the original conversation; the durable in-repo
reference for chrome, sidebar, and status-bar fidelity is
`.github/assets/screenshot.png` (real v0.6.x window, same chrome but 6 panes).
The 3-pane arrangement and sidebar items follow this spec's text.

## Layout (matches the reference screenshot)

- **Window chrome**: titlebar with macOS traffic lights (left) and the app's
  layout/settings icon cluster (right). Sidebar-mode proportions from
  `src/styles.css`: titlebar 34px, sidebar 200px, status bar 28px.
- **Sidebar**: workspace list with round logo, name, muted path. Items:
  `stackgrid` (active, close button), `glowarena`, `glow-workspace`,
  `glow-api`, then `+ Open workspace`. Names and paths as in the screenshot.
- **Pane grid — 3 panes**: left column stacked vertically — `claude` (top,
  focused with accent border) and `codex` (bottom); right column one
  full-height pane — `opencode`.
- **Status bar**: `main` | workspace path | `3 panes` | `Tokyo Night` |
  `split ⌘D` | `new tab ⌘T`.

## Visual language

- Port Tokyo Night tokens from the app (`src/styles.css` fallbacks): bg
  `#16161e`, fg `#c0caf5`, accent `#7aa2f7`, hairline borders via color-mix,
  flat design with no drop shadows. Replaces the landing's invented purple
  palette for the stage only.
- Monospace stack identical to the app (`SF Mono, JetBrains Mono, …`).

## Pane content

- 100% English, regardless of the landing locale (EN/VI switch must not
  translate stage content).
- Each pane is a believable agent session with agent-specific detail:
  - **claude**: transcript chunks, thinking spinner (`✳ …`), status line with
    usage bar and `stackgrid git:(main*)`.
  - **codex**: its own transcript and prompt/status styling.
  - **opencode**: its own transcript and prompt/status styling.

## Animation

- Simulate AI streaming: transcript text appears in chunks (word/line groups,
  not per-character), spinner while "thinking", blinking cursor, new lines
  push older ones up.
- The three panes run on staggered rhythms; the loop is infinite with rest
  gaps so it reads as live work, not a GIF.
- `prefers-reduced-motion: reduce` → render a static completed frame, no
  streaming, no blinking.
- Scheduling is timestamp-based and tolerant of background-tab timer
  throttling (no runaway catch-up when the tab regains focus).
- Switching the landing locale re-renders direction A, which restarts the
  stream loop from the beginning — accepted behavior.

## Accessibility

- The stage is decorative: the `figure` keeps a static `aria-label`; the
  streaming transcript region is `aria-hidden` so screen readers are not
  spammed by DOM updates (no `aria-live`).

## Scope

- Touches only `marketing/landing-prototype/`: `src/product-stage.js` (pane
  data + stream script), `src/directions/a.js` (stage markup),
  `styles/direction-a.css` (stage styles), `src/copy.js` (stage strings become
  locale-independent English).
- The Focus Expand demo dialog (real video) stays untouched.
- The old stage artifacts are removed with the redesign: `agentPanes`
  (gemini/shell entries), `sequenceSteps`, the stage bar, crosshairs, focus
  frame, their CSS, and the now-unused copy keys (`stagePreset`,
  `stageWorkspace`, `stageFocus`).
- No changes to app source (`src/`); it is read only as the token reference.
- Responsive: the stage scales down proportionally; below the existing narrow
  breakpoint the sidebar may collapse so panes stay legible.

## Success criteria

- Side-by-side with the reference screenshot, the stage reads as the same
  app: chrome, sidebar, pane arrangement, status bar, palette.
- Streaming animation is smooth, loops cleanly, and respects reduced motion.
- Landing builds and passes eye review on screenshots (per the landing spec's
  standing rule that build output is never proof of visual success).
