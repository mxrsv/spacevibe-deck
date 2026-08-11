import { settings } from "../settings/settings-store";
import { getPreset } from "../settings/themes";
import { statusInfo } from "../terminal/tabs-store";
import { tildify } from "../lib/process-info";
import { shortcutLabel } from "../lib/shortcut-label";
import { currentFileStatus } from "../files/file-surface-store";

export function StatusBar() {
  const info = statusInfo.value;
  const themeLabel = getPreset(settings.value.themeId).label;
  // With a file tab active the left segment is the file's path RELATIVE to the
  // workspace, not a pane's CWD — there is no pane, and an absolute path in a
  // 28px bar is unreadable anyway (spec §7).
  const file = currentFileStatus();
  const cwd =
    file !== null
      ? file.relativePath
      : info.cwd === null
        ? null
        : tildify(info.cwd, info.home);
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
      {file === null && info.agent !== null && (
        <>
          <span class="status__vsep" aria-hidden="true" />
          <span class="status__seg status__seg--accent">{info.agent}</span>
        </>
      )}
      {file !== null && (
        <>
          <span class="status__vsep" aria-hidden="true" />
          <span class="status__seg">{file.position}</span>
          <span class="status__vsep" aria-hidden="true" />
          <span class="status__seg">{file.encoding}</span>
          <span class="status__vsep" aria-hidden="true" />
          <span class="status__seg">{file.eol}</span>
        </>
      )}
      <div class="status__right">
        {/* Absent, not zero-with-a-label: a file tab owns no panes, and
            "0 panes" reads as a broken window rather than a different kind
            of surface (spec §7). */}
        {info.paneCount !== null && (
          <>
            <span class="status__seg">
              {info.paneCount} {info.paneCount === 1 ? "pane" : "panes"}
            </span>
            <span class="status__vsep" aria-hidden="true" />
          </>
        )}
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
