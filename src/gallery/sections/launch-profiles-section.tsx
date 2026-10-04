import { createPortal } from "preact/compat";
import { applyThemeVars } from "../../lib/theme-vars";
import { resolveTheme } from "../../settings/themes";
import { useEffect } from "preact/hooks";
import { SettingsScreen } from "../../ui/settings/settings-screen";
import { activeCategory } from "../../ui/settings/active-category-store";
import { useSignal, useSignalEffect } from "@preact/signals";
import { settings } from "../../settings/settings-store";
import { agentsProbed, detectedAgents } from "../../terminal/agent-detection-store";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { LaunchProfileEditor } from "../../ui/settings/launch-profile-editor";
import { SectionHead, Specimen } from "../specimen";

/** DECK-63: B was promoted into the shipping editor. Only the real component
 * remains here; gallery settings sync is in-memory, never the owner's store. */
export function LaunchProfilesSection() {
  const reviewing = useSignal(true);
  useEffect(() => {
    activeCategory.value = "appearance";
  }, []);
  const compact = useSignal(false);
  const seeded = useSignal(true);

  useSignalEffect(() => {
    applyThemeVars(document.documentElement.style, resolveTheme(settings.value));
  });

  useSignalEffect(() => {
    agentsProbed.value = true;
    detectedAgents.value = seeded.value
      ? ["claude", "codex", "opencode", "gemini"].map((name) => ({
          name,
          path: `/usr/local/bin/${name}`,
        }))
      : [];
    settings.value = {
      ...DEFAULT_SETTINGS,
      launchProfiles: [
        {
          id: "lp:codex-search",
          command: "codex --dangerously-bypass-approvals-and-sandbox --search",
        },
      ],
      defaultLaunchProfiles: { codex: "lp:codex-search" },
    };
  });

  return reviewing.value ? (
    createPortal(
      <SettingsScreen
        open
        onClose={() => {
          reviewing.value = false;
        }}
      />,
      document.body,
    )
  ) : (
    <>
      <SectionHead
        title="Agent settings · selected B"
        blurb="Command first, with launch, model and integration groups. Real app component; changes stay in gallery memory."
      />
      <div class="lp-gallery-toggle">
        <button
          type="button"
          class="cfg-btn"
          onClick={() => {
            activeCategory.value = "appearance";
            reviewing.value = true;
          }}
        >
          Open Studio settings
        </button>
        <button
          type="button"
          class="cfg-btn"
          onClick={() => {
            compact.value = !compact.value;
          }}
        >
          {compact.value ? "Review at 720px" : "Review at 480px"}
        </button>
        <button
          type="button"
          class="cfg-btn"
          onClick={() => {
            seeded.value = !seeded.value;
          }}
        >
          {seeded.value ? "Show no installed agents" : "Show installed agents"}
        </button>
      </div>
      <div class={compact.value ? "lp-gallery-review is-compact" : "lp-gallery-review"}>
        <Specimen
          name="B · Command first"
          note="Selected by owner · shipping component · 720px / 480px"
          surface="chrome-2"
        >
          <div class="lp-gallery-panel settings-screen__section">
            <div class="lp-gallery-title">
              Agents<span>Launch and configure your agent CLIs</span>
            </div>
            <LaunchProfileEditor />
          </div>
        </Specimen>
      </div>
    </>
  );
}
