import { createFileSurfaceController } from "../../files/file-surface-controller";
import type { ExternalAppChoice } from "../../links/external-app-choices";
import { activeTabIndex } from "../../terminal/tabs-store";
import { AttentionStripChip } from "../../ui/attention/attention-strip-chip";
import { TabStrip } from "../../ui/tab-strip";
import { ExternalAppButton } from "../../ui/toolbar/external-app-button";
import { DeckToolbar } from "../../ui/toolbar/deck-toolbar";

/**
 * The shipping strip with the needs-you chip mounted, at a chosen width: the
 * real `TabStrip` (every space's mark, the document and browser chips), the
 * real toolbar with its external-app button and `More`, and the chip leading
 * the trailing controls exactly as `App` mounts it. Seeded tabs, so the chip
 * counts what the gallery's rail shows.
 *
 * `withChip` off draws the same strip without it, which is what the width
 * measurement in the PR compares against.
 */

const NOOP = (): void => {};

const FILES = createFileSurfaceController();

/** No installed-app icon: the initial stands in, as it does where none is read. */
const EDITOR: readonly ExternalAppChoice[] = [
  { id: "ghostty", label: "Ghostty", group: "terminal", iconDataUrl: null },
];

export function StripAtWidth({ width, withChip }: { width: number; withChip: boolean }) {
  return (
    <div
      class="gx-attn-stripframe"
      style={{ width: `${width}px` }}
      data-strip-width={width}
      data-chip={String(withChip)}
    >
      <div class="stage__strip" data-tauri-drag-region>
        <TabStrip
          onSelectTab={(index) => {
            activeTabIndex.value = index;
          }}
          onCloseTab={NOOP}
          onSelectBrowser={NOOP}
          onCloseBrowser={NOOP}
          onSelectAgentBoard={NOOP}
          onCloseAgentBoard={NOOP}
          fileController={FILES}
          // The shipping strip lists every workspace's spaces (DL-35.3).
          scopeToActiveRepository={false}
        />
        <div class="stage__strip-actions">
          <DeckToolbar
            browserActive={false}
            settingsOpen={false}
            expandActive={false}
            promptsOpen={false}
            promptsUnavailable={null}
            onToggleBrowser={NOOP}
            onSplitRow={NOOP}
            onSplitColumn={NOOP}
            onToggleExpand={NOOP}
            onClosePane={NOOP}
            onTogglePrompts={NOOP}
            onToggleSettings={NOOP}
            externalApp={
              <ExternalAppButton
                choices={EDITOR}
                selected="ghostty"
                workspacePath="/Users/deck/spacevibe-deck"
                onOpen={NOOP}
                onSelect={NOOP}
              />
            }
            attention={withChip ? <AttentionStripChip onFocusPane={NOOP} /> : undefined}
          />
        </div>
      </div>
    </div>
  );
}
