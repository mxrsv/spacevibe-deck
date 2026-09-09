# Stackgrid Landing Page — Design Spec

Status: approved for prototype planning
Date: 2026-07-10

## Goal

Create a professional, non-generic bilingual landing page for Stackgrid that
persuades macOS developers who run multiple AI coding agents to watch the product
demo, then download the app or inspect the GitHub repository.

The landing page must be selected through repeated human eye-review. Build output
is evidence for review, never proof that the design is visually successful.

## Audience and positioning

- Primary audience: developers already running several AI agent CLIs in parallel.
- Product position: an agent-CLI command center, not a general terminal replacement.
- Primary conversion: watch the product demo.
- Secondary conversions: download for macOS and view the GitHub repository.
- Core proof sequence: open a workspace preset, materialize a multi-agent grid, then
  expand the focused pane to 65% while every other agent remains visible.
- Language: English and Vietnamese. Choose the initial locale from the user's system
  and always provide a manual EN/VI switch.

## Approved narrative

### Shared hero copy

Headline:

> Run the grid. Keep every agent in sight.

Subhead:

> Stackgrid is a native macOS terminal built to launch, watch, and steer AI coding
> agents in parallel.

Primary CTA: `Watch the 45-sec demo`
Secondary CTA: `View on GitHub`

The Vietnamese version must be edited as natural product copy rather than translated
word for word.

### Full-page story

1. **Hero — preset to focus.** A living product focal demonstrates the approved
   preset → grid → Focus Expand sequence.
2. **Start from a known formation.** Show the Open board and layout presets.
3. **Give every pane an agent.** Show the one-shot picker for Claude Code, Codex,
   Gemini CLI, or a plain shell.
4. **See the system. Work the detail.** Show the multi-agent grid and the real Focus
   Expand video.
5. **Your shell, intact.** Prove real PTY, `$SHELL -l`, PATH/aliases/dotfiles,
   local-only operation, and no telemetry.
6. **Shortcut ribbon and close.** Let users inspect the keyboard workflow, then offer
   download and GitHub actions.

Each section has one dominant product artifact and one message. Do not use a generic
feature-card grid or icon-card repetition.

## Design funnel

Use a 5 → 3 → 1 funnel.

### Round 1 — five broad direction specimens

Build five throwaway, standalone HTML hero specimens. Keep copy, product sequence,
and CTA hierarchy identical so the user judges visual direction rather than content.

1. **Agent Mission Control** — deep graphite, electric-lime signal, and a PTY grid
   rendered as a live coordination system.
2. **Native Spatial Studio** — light macOS-like material surfaces, spatial windows,
   controlled depth, and cobalt accent.
3. **Operator's Field Manual** — warm paper, black ink, vermilion, technical diagrams,
   and asymmetric editorial composition.
4. **Signal Chamber** — cinematic darkness with cyan/amber volumetric light shaping
   the panes; Focus Expand acts as the stage climax.
5. **Precision CRT** — restrained retro-future instrumentation using phosphor/amber,
   scan fields, and precise terminal typography without nostalgic cosplay.

The round-one surface lives at `marketing/landing-prototype/` and runs with one
command: `npm run prototype:landing`.

- `?direction=A` through `?direction=E` selects a direction.
- A floating review switcher supports click and left/right arrow keys.
- `?lang=en|vi` overrides system locale.
- The switcher is visibly separate from the design being reviewed.
- Only the current review round lives on this surface.

The user shortlists roughly three directions by eye. Before clearing this surface,
record the selected qualities and reasons in `frontend-taste-profile.md`.

### Round 2 — three Preact directions

Rebuild the shortlisted directions in Preact on a dedicated demo server separate from
the Tauri production app. This is the production-fidelity review surface for detailed
treatment and motion.

Continue with gated rounds:

1. Offer two or three divergent desktop/mobile composition greyboxes.
2. Fill the approved composition with real bilingual content and real product assets.
3. Propose explicit treatment values element by element; apply only after approval.
4. Offer two or three motion timing/easing variants and review them as rendered video.
5. Promote the winning direction into the real landing artifact before deleting the
   losing variants.

Prototype code is throwaway and must not be promoted directly to production.

## Visual rules

- One focal artifact in the first viewport: the working Stackgrid pane system.
- One hot accent per direction, used for focal state, primary action, and key signal.
- Backgrounds carry emotion through material, texture, light, or engineered fields.
- Common elements must receive authored treatment; no default buttons, cards, grids,
  badges, dividers, or navigation skins.
- Avoid generated-landing defaults: purple blobs, empty oversized headline heroes,
  centered section stacks, three-card feature grids, nested cards, and filler metrics.
- Composition must remain distinctive when copy and color are swapped.
- Desktop and mobile are separate compositions, not a scaled version of one another.

## Motion, accessibility, and performance

- Motion direction: cinematic but controlled. The hero and demo may be expressive;
  reading sections stay calm.
- Use transform and opacity for routine motion. Do not scroll-jack.
- Support `prefers-reduced-motion` from the first prototype.
- Use the existing poster image; list WebM before MP4 and retain native video controls
  or an accessible equivalent.
- Round one must not require WebGL for first paint.
- Keyboard access covers direction switching, locale switching, CTAs, and product
  controls shown as interactive.
- Text and controls meet WCAG AA contrast targets.
- No analytics, persistence, or product mutations in prototypes.

## Product-truth constraint

Only market features with evidence in the current application or repository assets.
Do not present planned or partially implemented behavior as shipped. The approved
hero relies on current, evidenced capabilities: layout presets, multi-pane real PTYs,
agent selection, and Focus Expand.

## Review and cleanup contract

At every offer-N gate:

1. Render only the current alternatives.
2. Let the user inspect desktop and mobile.
3. Record and promote the selected decision.
4. Only then remove losing alternatives and reuse the demo surface.

The final landing page is not considered visually approved until the user has reviewed
the rendered production-fidelity page. Passing TypeScript, build, or automated tests
does not substitute for that review.
