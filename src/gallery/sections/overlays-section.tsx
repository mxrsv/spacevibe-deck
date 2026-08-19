import { useSignal } from "@preact/signals";
import { persistError } from "../../chrome/events";
import type { CustomAgent } from "../../lib/agent-catalog";
import type { QuickDestination } from "../../repositories/worktree-destinations";
import { PersistErrorBar } from "../../presets/persist-error-bar";
import { PresetEditor } from "../../presets/preset-editor";
import { SavePresetDialog } from "../../presets/save-preset-dialog";
import { AgentQuickPicker } from "../../ui/agent-quick-picker";
import { SettingsScreen } from "../../ui/settings/settings-screen";
import { SEED_PRESETS } from "../seed-data";
import { SectionHead, Specimen, StateLabel } from "../specimen";

/**
 * Surfaces that cover the stage: the full-window settings screen, the three
 * modals, the transient chrome bar, and the drag/zoom overlays.
 *
 * The modal gap this file used to document — a genre with a radius, a scrim
 * and a rise-in that no DL section governed — closed on 2026-08-16 with
 * DL §29 and [`Modal`](../../ui/modal.tsx). Each specimen below therefore
 * brings its OWN scrim, through that shell; the gallery no longer wraps one
 * around them (it used to, which painted the wash twice).
 *
 * `.drop-overlay` and `.zoom-overlay` are single-class elements the layout
 * engine and the drag controller attach at runtime (`layout-engine.ts`,
 * `pane-drag.ts`), so the class here carries the entire visual — nothing is
 * being reconstructed.
 */

const NOOP = (): void => {};

/** claude/codex/gemini found on `$PATH`; the declared "Aider" is not, so the
 * specimen shows both a normal chip and the dashed "declared, but missing"
 * state at once. */
const SEED_DETECTED_AGENTS: readonly { name: string; path: string }[] = [
  { name: "claude", path: "/usr/local/bin/claude" },
  { name: "codex", path: "/usr/local/bin/codex" },
  { name: "gemini", path: "/usr/local/bin/gemini" },
];

const SEED_CUSTOM_AGENTS: readonly CustomAgent[] = [
  { id: "custom:aider", label: "Aider", command: "aider --model gpt-4" },
];

/** Two worktrees of one repository, so the destination row is a real menu. */
const SEED_DESTINATIONS: readonly QuickDestination[] = [
  {
    path: "/dev/spacevibe-deck",
    name: "spacevibe-deck",
    branch: "main",
    primary: true,
  },
  {
    path: "/dev/deck-modal-shell",
    name: "deck-modal-shell",
    branch: "feat/modal-shell",
    primary: false,
  },
];

function PersistBarSpecimen() {
  return (
    <div class="gx-anchorpad">
      <button
        type="button"
        class="cfg-btn"
        onClick={() => {
          persistError.value =
            "Could not save presets — the change may not survive relaunch.";
        }}
      >
        trigger the bar
      </button>
      <PersistErrorBar />
      <StateLabel>
        auto-dismisses after 6s — that timing is the specimen
      </StateLabel>
    </div>
  );
}

export function OverlaysSection() {
  const settingsOpen = useSignal(true);

  return (
    <>
      <SectionHead
        title="Overlays"
        blurb="Settings, dialogs and transient states use the same surface hierarchy instead of separate visual genres."
      />

      <Specimen
        name=".settings-screen"
        note="DL §11 — fixed rail, section area owns all scrolling; the rail's active item is the same 2px + 4% wash as row hover"
        surface="bg"
        tall
      >
        <SettingsScreen
          open={settingsOpen.value}
          onClose={() => {
            // Re-opening immediately keeps the specimen visible; the real app
            // hands focus back to a pane here, which the gallery has none of.
            settingsOpen.value = false;
            settingsOpen.value = true;
          }}
        />
      </Specimen>

      <Specimen
        name=".modal-scrim + .preset-editor"
        note="DL §29 — the one modal whose scrim is inert (DL-29.3): it holds an unsaved draft, so only Escape and Cancel close it"
        surface="bg"
        tall
      >
        <PresetEditor onCancel={NOOP} onCreate={NOOP} />
      </Specimen>

      <Specimen
        name=".modal-scrim + save dialog"
        note="the second modal; same shell, same blurred scrim, its own body"
        surface="bg"
        tall
      >
        <SavePresetDialog
          existing={SEED_PRESETS}
          onCancel={NOOP}
          onSave={NOOP}
        />
      </Specimen>

      <Specimen
        name=".modal-scrim + .agent-quick-picker"
        note="the + button's fast path (DL-29.7) — one destination stated above a COLUMN of agent rows; DL-29.8 added the key line under them, arrow-key roving focus, and a missing row that opens Settings instead of launching"
        surface="bg"
        tall
      >
        <AgentQuickPicker
          detected={SEED_DETECTED_AGENTS}
          customAgents={SEED_CUSTOM_AGENTS}
          destinations={SEED_DESTINATIONS}
          initialDestination={SEED_DESTINATIONS[1].path}
          onSelect={NOOP}
          onCancel={NOOP}
          onManageAgents={NOOP}
        />
      </Specimen>

      <Specimen
        name=".persist-error-bar"
        note="the one transient message surface in chrome"
        surface="chrome-1"
      >
        <PersistBarSpecimen />
      </Specimen>

      <Specimen
        name=".drop-overlay · .pane-drag-ghost"
        note="attached to <body> at runtime by pane-drag.ts, sized from the hit-tested pane rect — the gallery supplies that rect and nothing else"
        surface="bg"
      >
        <div class="gx-overlaypad">
          <div class="gx-overlaypad__cell">
            <StateLabel>drop target — move</StateLabel>
            <div class="gx-overlaypad__pane">
              <div class="drop-overlay" />
            </div>
          </div>
          <div class="gx-overlaypad__cell">
            <StateLabel>drop target — swap</StateLabel>
            <div class="gx-overlaypad__pane">
              <div class="drop-overlay is-swap" />
            </div>
          </div>
          <div class="gx-overlaypad__cell">
            <StateLabel>drag ghost</StateLabel>
            <div class="gx-overlaypad__pane">
              <div class="pane-drag-ghost">claude — spacevibe-deck</div>
            </div>
          </div>
        </div>
        {/* `.zoom-overlay` is deliberately absent: it paints `var(--bg)` over
            the grid and nothing else, so a specimen of it is an empty
            rectangle. It is a cover, not a visual. */}
      </Specimen>
    </>
  );
}
