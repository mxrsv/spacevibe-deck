import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { MessageSquareText } from "lucide-preact";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import { TabPopover } from "../../ui/tab-popover";
import { PromptPopover } from "../../prompts/prompt-popover";
import type { PromptTarget } from "../../prompts/inject";
import {
  EMPTY_PROMPT_ASSETS,
  type PromptAssets,
} from "../../prompts/prompt-assets-client";
import { defaultPromptAssetsClient } from "../../prompts/prompt-assets-client";
import { SectionHead, Specimen } from "../specimen";

/**
 * DL §13's anchored popovers, both of them, live.
 *
 * They are opened by their real triggers rather than forced open, because a
 * popover's dismissal rules (Esc, outside click, completing the action) are
 * half of what §13 specifies and a permanently-pinned specimen would show
 * none of them.
 *
 * Worth looking at side by side: `.tab-popover` uses a real 1px border and an
 * 8px-plus radius while `.prompt-popover` uses the inset hairline DL-13.1
 * asks for. They should not disagree.
 */

const TARGET: PromptTarget = {
  paneId: 1,
  agent: "claude",
  cwd: "/Users/deck/spacevibe-deck",
};

function TabPopoverSpecimen() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const open = useSignal(false);
  const at = useSignal<{ left: number; top: number } | null>(null);

  const toggle = (): void => {
    const anchor = anchorRef.current;
    if (anchor === null) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    at.value = { left: rect.left, top: rect.bottom + 6 };
    open.value = !open.value;
  };

  return (
    <div class="gx-anchorpad">
      <button
        ref={anchorRef}
        type="button"
        class="tab is-active"
        onClick={toggle}
      >
        <span class="tab__dot" style={{ background: "var(--cyan)" }} />
        <span class="tab__label">click to open options</span>
      </button>
      {open.value && at.value !== null && anchorRef.current !== null && (
        <TabPopover
          left={at.value.left}
          top={at.value.top}
          anchorEl={anchorRef.current}
          name={null}
          dotColor={null}
          hasLogo={false}
          onRename={() => {}}
          onPickColor={() => {}}
          onSetLogo={() => {}}
          onRemoveLogo={() => {}}
          onClose={() => {
            open.value = false;
          }}
        />
      )}
    </div>
  );
}

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
          <DeckIcon icon={MessageSquareText} size={CHROME_ICON} />
        </button>
        {open.value && (
          <PromptPopover
            capture={async () => TARGET}
            loadAssets={loadAssets}
            inject={async () => "pasted"}
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
        name=".tab-popover"
        note="rename + dot colour + logo; opened from the active tab"
        surface="chrome-1"
      >
        <TabPopoverSpecimen />
      </Specimen>

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
