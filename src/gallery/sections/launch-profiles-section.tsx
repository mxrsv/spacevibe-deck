import { useSignal, useSignalEffect } from "@preact/signals";
import { settings } from "../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { LaunchProfileEditor } from "../../ui/settings/launch-profile-editor";
import type { LaunchProfile } from "../../lib/launch-profile";
import { SectionHead, Specimen } from "../specimen";

/**
 * The agent list, mounted from the REAL component.
 *
 * Re-typing its markup here would make this page a second source of truth and
 * it would drift the first time a row changed — the same reasoning
 * `rows-section.tsx` gives for mounting `SETTINGS_CATEGORIES` directly.
 *
 * The only thing this file owns is the DATA: the gallery seeds the settings
 * signal with a few profiles so the page shows what a populated list looks
 * like beside an empty one. That write is to the in-memory signal only — the
 * gallery entry installs a memory settings sync, so nothing reaches the
 * owner's real `settings.json`.
 */

const SEEDED: readonly LaunchProfile[] = [
  { id: "lp:claude", command: "claude" },
  { id: "lp:claude-plan", command: "claude --permission-mode plan" },
  {
    id: "lp:codex-bypass",
    command: "codex --dangerously-bypass-approvals-and-sandbox",
  },
  { id: "lp:cursor-force", command: "cursor-agent --force" },
  { id: "lp:gemini-yolo", command: "gemini --approval-mode yolo" },
];

const SEEDED_DEFAULTS: Readonly<Record<string, string>> = {
  claude: "lp:claude",
  codex: "lp:codex-bypass",
  "cursor-agent": "lp:cursor-force",
  gemini: "lp:gemini-yolo",
};

export function LaunchProfilesSection() {
  const seeded = useSignal(true);

  useSignalEffect(() => {
    settings.value = seeded.value
      ? {
          ...DEFAULT_SETTINGS,
          launchProfiles: SEEDED,
          defaultLaunchProfiles: SEEDED_DEFAULTS,
        }
      : DEFAULT_SETTINGS;
  });

  return (
    <>
      <SectionHead
        title="Presets"
        blurb="Launch commands for your agents. A starred row is what that CLI opens with; an agent with no command of its own still shows the bare binary."
      />

      <div class="lp-gallery-toggle">
        <button
          type="button"
          class="cfg-btn"
          onClick={() => {
            seeded.value = !seeded.value;
          }}
        >
          {seeded.value ? "show empty state" : "show with commands"}
        </button>
      </div>

      <Specimen
        name="Settings → Agents, real component"
        note="brand mark · command (binary --text, flags --text-faint) · star = default · free-text add"
        surface="chrome-2"
      >
        <div class="settings-screen__section">
          <LaunchProfileEditor />
        </div>
      </Specimen>

      <Specimen
        name="compact (480px)"
        note="Deck's supported minimum width (DL-11.7)"
        surface="chrome-2"
      >
        <div class="lp-compact">
          <div class="settings-screen__section">
            <LaunchProfileEditor />
          </div>
        </div>
      </Specimen>
    </>
  );
}
