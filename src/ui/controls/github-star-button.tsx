import { GithubLogo, Star } from "@phosphor-icons/react";
import { useSignal, useSignalEffect } from "@preact/signals";
import {
  ensureGithubStarChecked,
  githubStarAskOpen,
  requestGithubStar,
} from "../../settings/github-star-store";
import { DeckIcon, ROW_ICON } from "./deck-icon";

export type GithubStarVariant = "board" | "header";

export interface GithubStarButtonProps {
  /**
   * `board` is the Open Board's standing call to action — a row of its own
   * under the primary actions. `header` is the Settings header's control,
   * shaped exactly like `Back` beside it because DL-3.7 keeps that whole
   * surface achromatic.
   */
  readonly variant: GithubStarVariant;
  readonly disabled?: boolean;
}

/**
 * "Star on GitHub", the one place Deck asks for something back.
 *
 * Both mounts render this component, so the wording, the action and the
 * condition for showing it cannot drift apart. It renders NOTHING once the
 * ask is answered: the star was made, or the user was sent to the repository
 * page — and `ensureGithubStarChecked` is what revives it if the account
 * stops starring later.
 */
export function GithubStarButton({ variant, disabled }: GithubStarButtonProps) {
  const busy = useSignal(false);

  // The check is a `gh` call, so it never blocks paint and its failure is
  // silence. `useSignalEffect`, not a mount effect: the settings snapshot may
  // still be loading when the board first paints, and the check has to run
  // against the loaded value — it declines and waits until then, once per
  // window, whichever mount gets there first.
  useSignalEffect(() => {
    void ensureGithubStarChecked();
  });

  if (!githubStarAskOpen.value) {
    return null;
  }

  const handleClick = async (): Promise<void> => {
    if (busy.value) {
      return;
    }
    busy.value = true;
    try {
      await requestGithubStar();
    } finally {
      busy.value = false;
    }
  };

  const inert = busy.value || disabled === true;

  if (variant === "header") {
    return (
      <button
        type="button"
        class="settings-screen__star"
        title="Star SpaceVibe Deck on GitHub"
        disabled={inert}
        onClick={() => void handleClick()}
      >
        <DeckIcon icon={GithubLogo} size={ROW_ICON} />
        {busy.value ? "Starring…" : "Star on GitHub"}
      </button>
    );
  }

  return (
    <button
      type="button"
      class="board-home__star"
      disabled={inert}
      onClick={() => void handleClick()}
    >
      <DeckIcon icon={Star} size={ROW_ICON} class="board-home__star-mark" />
      {/* No external-link arrow: with `gh` present the star happens in place
          and nothing navigates. Opening the page is the FALLBACK, and a glyph
          promising it would be wrong on the path that works. */}
      <span class="board-home__star-text">
        {busy.value ? "Starring…" : "Star spacevibe-deck on GitHub"}
      </span>
    </button>
  );
}
