import { settings } from "../settings/settings-store";
import { getPreset } from "../settings/themes";
import { statusInfo } from "../terminal/tabs-store";
import { tildify } from "../lib/process-info";
import { shortcutLabel } from "../lib/shortcut-label";

export function StatusBar() {
  const info = statusInfo.value;
  const themeLabel = getPreset(settings.value.themeId).label;
  const cwd = info.cwd === null ? null : tildify(info.cwd, info.home);
  return (
    <footer class="status">
      {info.branch !== null && (
        <>
          <span class="status__seg">
            <span class="status__gitdot" aria-hidden="true" />
            {info.branch}
          </span>
          <span class="status__vsep" aria-hidden="true" />
        </>
      )}
      {cwd !== null && <span class="status__seg">{cwd}</span>}
      {info.agent !== null && (
        <>
          <span class="status__vsep" aria-hidden="true" />
          <span class="status__seg status__seg--accent">{info.agent}</span>
        </>
      )}
      <div class="status__right">
        <span class="status__seg">
          {info.paneCount} {info.paneCount === 1 ? "pane" : "panes"}
        </span>
        <span class="status__vsep" aria-hidden="true" />
        <span class="status__seg">{themeLabel}</span>
        <span class="status__vsep" aria-hidden="true" />
        <span class="status__seg">
          <span class="status__hint">split</span>
          <kbd class="status__kbd">{shortcutLabel("split-row")}</kbd>
          <span class="status__hint">new tab</span>
          <kbd class="status__kbd">{shortcutLabel("new-tab")}</kbd>
        </span>
      </div>
    </footer>
  );
}
