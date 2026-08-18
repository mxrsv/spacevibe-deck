import { ChatText } from '@phosphor-icons/react';
import { useSignal } from '@preact/signals';
import { CHROME_ICON, DeckIcon } from '../../ui/controls/deck-icon';
import { PromptPopover } from '../../prompts/prompt-popover';
import type { PromptTarget } from '../../prompts/inject';
import {
  EMPTY_PROMPT_ASSETS,
  type PromptAssets,
  defaultPromptAssetsClient,
} from '../../prompts/prompt-assets-client';
import { SectionHead, Specimen } from '../specimen';

/**
 * DL §13's anchored popover, live.
 *
 * `.tab-popover` was the other one until 2026-08-16, when it was removed with
 * the tab rename and workspace-logo features it carried; the section keeps its
 * name because the genre (DL §13) still has a member.
 *
 * It is opened by its real trigger rather than forced open, because a
 * popover's dismissal rules (Esc, outside click, completing the action) are
 * half of what DL §13 specifies and a permanently-pinned specimen would show
 * none of them.
 */

const TARGET: PromptTarget = {
  paneId: 1,
  agent: 'claude',
  cwd: '/Users/deck/spacevibe-deck',
};

function PromptPopoverSpecimen() {
  const open = useSignal(true);

  const loadAssets = async (target: PromptTarget): Promise<PromptAssets> => {
    if (target.agent === null) {
      return EMPTY_PROMPT_ASSETS;
    }
    return defaultPromptAssetsClient.list(target.agent, target.cwd);
  };

  return (
    <div class="gx-anchorpad gx-anchorpad--right">
      <span class="prompts-anchor">
        <button
          type="button"
          class="iconbtn"
          aria-expanded={open.value}
          aria-label="Prompt Board"
          onClick={() => {
            open.value = !open.value;
          }}
        >
          <DeckIcon icon={ChatText} size={CHROME_ICON} />
        </button>
        {open.value && (
          <PromptPopover
            capture={async () => TARGET}
            loadAssets={loadAssets}
            inject={async () => 'pasted'}
            isAlive={() => true}
            onClose={() => {
              open.value = false;
            }}
          />
        )}
      </span>
    </div>
  );
}

export function PopoversSection() {
  return (
    <>
      <SectionHead
        title="Popovers"
        blurb="Both anchored surfaces share one elevated frame, one radius and one interaction rhythm."
      />

      <Specimen
        name=".prompt-popover"
        note="Prompt Board — the template list is empty until you add one, which is itself the empty state"
        surface="chrome-1"
      >
        <PromptPopoverSpecimen />
      </Specimen>
    </>
  );
}
