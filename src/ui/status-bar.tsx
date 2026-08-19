import { settings } from "../settings/settings-store";
import { getPreset } from "../settings/themes";
import { statusInfo } from "../terminal/tabs-store";
import { tildify } from "../lib/process-info";
import { shortcutLabel } from "../lib/shortcut-label";
import { activeFileTab, documentFor } from "../files/file-surface-store";
import { currentFileStatus } from "../files/file-status";

export function StatusBar() {
  const info = statusInfo.value;
  const themeLabel = getPreset(settings.value.themeId).label;
  const cwd = info.cwd === null ? null : tildify(info.cwd, info.home);
  const splitRow = shortcutLabel("split-row");
  const newTab = shortcutLabel("new-tab");
  // A file surface reads its own branch of `statusInfo` — relative path,
  // dirty, position and encoding/EOL, instead of cwd and pane count (spec
  // §7). `currentFileStatus()` is null the instant a terminal tab holds the
  // stage again, so this branches the same way `paneCount` already does.
  const fileStatus = currentFileStatus();
  const fileDirty = documentFor(activeFileTab.value)?.dirty ?? false;
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
      {fileStatus !== null ? (
        <span class="status__seg">
          {fileStatus.relativePath}
          {fileDirty && (
            <span class="status__dirty-dot" aria-hidden="true" title="Unsaved changes" />
          )}
        </span>
      ) : (
        cwd !== null && <span class="status__seg">{cwd}</span>
      )}
      {info.agent !== null && (
        <>
          <span class="status__vsep" aria-hidden="true" />
          <span class="status__seg status__seg--accent">{info.agent}</span>
        </>
      )}
      <div class="status__right">
        {fileStatus !== null ? (
          <>
            <span class="status__seg">{fileStatus.position}</span>
            <span class="status__vsep" aria-hidden="true" />
            <span class="status__seg">{fileStatus.encoding}</span>
            <span class="status__vsep" aria-hidden="true" />
            <span class="status__seg">{fileStatus.eol}</span>
          </>
        ) : (
          // Absent, never zero-with-a-label (spec §7): `paneCount` is null
          // while a file surface is active, and rendering `null panes` read
          // as a broken window rather than a different kind of surface.
          info.paneCount !== null && (
            <span class="status__seg">
              {info.paneCount} {info.paneCount === 1 ? "pane" : "panes"}
            </span>
          )
        )}
        <span class="status__vsep" aria-hidden="true" />
        <span class="status__seg">{themeLabel}</span>
        <span class="status__vsep" aria-hidden="true" />
        <span class="status__seg">
          {/* A hint is only a hint while the chord exists. An unbound action
              rendered an empty `kbd` pill — a floating border naming nothing. */}
          {splitRow !== null && (
            <>
              <span class="status__hint">split</span>
              <kbd class="status__kbd">{splitRow}</kbd>
            </>
          )}
          {newTab !== null && (
            <>
              <span class="status__hint">new tab</span>
              <kbd class="status__kbd">{newTab}</kbd>
            </>
          )}
        </span>
      </div>
    </footer>
  );
}
