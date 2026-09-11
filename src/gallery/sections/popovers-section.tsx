import { ChatText, Command } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { createPortal } from "preact/compat";
import { useRef } from "preact/hooks";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import { CardActionsMenu, type CardActions } from "../../ui/worktree-card-menus";
import type { MenuSubject } from "../../ui/agent-rail-card-model";
import { PromptPopover } from "../../prompts/prompt-popover";
import type { PromptTarget } from "../../prompts/inject";
import {
  EMPTY_PROMPT_ASSETS,
  type PromptAssets,
  defaultPromptAssetsClient,
} from "../../prompts/prompt-assets-client";
import { SectionHead, Specimen } from "../specimen";

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
  agent: "claude",
  cwd: "/Users/deck/spacevibe-deck",
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

/**
 * `⌘T`'s agent list (`openspec/changes/rail-create-consolidation`, design D1;
 * DL-13.7 and DL-27.25 amended): the rail card's own actions menu in its
 * FREE-STANDING placement. No card is beside it, so it states its destination
 * in a one-line heading and ends with `Open another project…` — the row that
 * keeps top-tab mode and a hidden sidebar one keyboard route from the board.
 *
 * The pad carries `data-strip-anchor`, which the placement reads before the
 * real strip: the surface hangs under THIS pad's leading edge, so it can be
 * reviewed here rather than under whichever `.stage__strip` the page holds.
 * It is `position: fixed` like every rail popover and closes on scroll, so
 * scroll the page and press again.
 */
const KEYBOARD_MENU_SUBJECT: MenuSubject = {
  project: "spacevibe-bench",
  path: "/Users/deck/spacevibe-bench",
  repositoryPath: "/Users/deck/spacevibe-bench",
  branch: "main",
  label: "main",
  labelled: true,
};

const NOOP = (): void => {};

const KEYBOARD_MENU_ACTIONS: CardActions = {
  agents: [
    { id: "claude", label: "Claude", detail: "claude --dangerously-skip-permissions" },
    { id: "codex", label: "Codex", detail: "codex --full-auto" },
  ],
  agentsResolved: true,
  onRunAgent: NOOP,
  onSplitHere: NOOP,
  onOpenFolder: NOOP,
  onOpenShell: NOOP,
  filesAppLabel: "Finder",
  onOpenBoard: NOOP,
};

function KeyboardActionsMenuSpecimen() {
  const open = useSignal(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div class="gx-anchorpad" data-strip-anchor>
      <button
        ref={trigger}
        type="button"
        class="iconbtn"
        aria-haspopup="menu"
        aria-expanded={open.value}
        aria-label="Raise the ⌘T agent list"
        onClick={() => {
          open.value = !open.value;
        }}
      >
        <DeckIcon icon={Command} size={CHROME_ICON} />
      </button>
      {/* Portalled to `<body>`: `.gx-section` carries a transform, which makes a
          `position: fixed` descendant position against the SECTION rather than
          the viewport (measured 2026-09-02: the surface landed 256px right and
          80px below the coordinates it computed). `App` mounts the real menu
          under no such ancestor, so the portal is what makes the specimen
          faithful, not a workaround the app needs. */}
      {open.value &&
        createPortal(
          <CardActionsMenu
            placement="free-standing"
            subject={KEYBOARD_MENU_SUBJECT}
            actions={KEYBOARD_MENU_ACTIONS}
            rect={null}
            trigger={trigger.current}
            onClose={() => {
              open.value = false;
            }}
          />,
          document.body,
        )}
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
        name=".asr-pop--actions[data-placement=free-standing]"
        note="⌘T's agent list — the heading states the destination because no card stands beside it; the last row reaches the Open board"
        surface="chrome-1"
      >
        <KeyboardActionsMenuSpecimen />
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
