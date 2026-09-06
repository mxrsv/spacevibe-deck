import { useSignal, useSignalEffect } from "@preact/signals";
import { settings } from "../../settings/settings-store";
import { detectedAgents } from "../../terminal/agent-detection-store";
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

const SEEDED: readonly LaunchProfile[] = [{ id: "lp:opencode-auto", command: "opencode --auto" }];

const SEEDED_DEFAULTS: Readonly<Record<string, string>> = {
  opencode: "lp:opencode-auto",
};

export function LaunchProfilesSection() {
  const seeded = useSignal(true);

  useSignalEffect(() => {
    // Half the catalog on $PATH, half not: the specimen has to show both
    // lists, and a browser harness detects nothing on its own.
    detectedAgents.value = seeded.value
      ? [
          { name: "claude", path: "/usr/local/bin/claude" },
          { name: "codex", path: "/usr/local/bin/codex" },
          { name: "opencode", path: "/usr/local/bin/opencode" },
          { name: "gemini", path: "/usr/local/bin/gemini" },
        ]
      : [];
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
        title="Agent catalog"
        blurb="Every agent Deck knows, split by what is on $PATH. The command under each name ships with the app — a fresh install launches it without anyone typing a flag."
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
