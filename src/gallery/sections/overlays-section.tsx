import type { ComponentChildren } from "preact";
import { useSignal } from "@preact/signals";
import { persistError } from "../../chrome/events";
import { PersistErrorBar } from "../../presets/persist-error-bar";
import { PresetEditor } from "../../presets/preset-editor";
import { SavePresetDialog } from "../../presets/save-preset-dialog";
import { SettingsScreen } from "../../ui/settings/settings-screen";
import { SEED_PRESETS } from "../seed-data";
import { SectionHead, Specimen, StateLabel } from "../specimen";

/**
 * Surfaces that cover the stage: the full-window settings screen, the two
 * modal drafts, the transient chrome bar, and the drag/zoom overlays.
 *
 * The modals are the interesting ones. DL-6.2 and DL-12.5 both say "never a
 * modal", yet `.preset-editor` and `.save-dialog` are modals over
 * `.modal-scrim`, with a radius and a rise-in animation no rule mentions. §13
 * covers popovers, §11 covers the settings shell; nothing covers these two.
 *
 * `.drop-overlay` and `.zoom-overlay` are single-class elements the layout
 * engine and the drag controller attach at runtime (`layout-engine.ts`,
 * `pane-drag.ts`), so the class here carries the entire visual — nothing is
 * being reconstructed.
 */

const NOOP = (): void => {};

function ScrimStage({ children }: { children: ComponentChildren }) {
  return <div class="modal-scrim">{children}</div>;
}

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
        note="radius 12px, rise-in 0.2s — a modal genre no DL section governs"
        surface="bg"
        tall
      >
        <ScrimStage>
          <PresetEditor onCancel={NOOP} onCreate={NOOP} />
        </ScrimStage>
      </Specimen>

      <Specimen
        name=".modal-scrim + save dialog"
        note="the second modal; compare its frame with the editor's"
        surface="bg"
        tall
      >
        <ScrimStage>
          <SavePresetDialog
            existing={SEED_PRESETS}
            onCancel={NOOP}
            onSave={NOOP}
          />
        </ScrimStage>
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
