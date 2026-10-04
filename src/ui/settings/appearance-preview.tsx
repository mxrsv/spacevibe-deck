import { settings } from "../../settings/settings-store";
import { resolveTheme } from "../../settings/themes";
import { toFontStack } from "../../terminal/pane";

/** A read-only specimen, never a PTY. Its styling reads the same settings as xterm. */
export function AppearancePreview() {
  const current = settings.value;
  const theme = resolveTheme(current);
  return (
    <aside class="appearance-preview" aria-label="Appearance preview">
      <div class="appearance-preview__heading">
        <span>Live preview</span>
        <span>Sample workspace</span>
      </div>
      <div class={`appearance-preview__window is-${current.tabBarPosition}`}>
        <div class="appearance-preview__tabs" aria-hidden="true">
          <span class="is-active">Terminal</span>
          <span>Editor</span>
        </div>
        <div class="appearance-preview__pane">
          {current.showPaneBar && (
            <div class="appearance-preview__pane-bar">Terminal · ~/project</div>
          )}
          <div
            class="appearance-preview__terminal"
            style={{
              background: theme.background,
              color: theme.foreground,
              fontFamily: toFontStack(current.fontFamily),
              fontSize: `${current.fontSize}px`,
            }}
          >
            <p>
              <span style={{ color: theme.green }}>~/project</span>{" "}
              <span style={{ color: theme.blue }}>main</span>
            </p>
            <p>$ npm run dev</p>
            <p style={{ color: theme.green }}>Ready in 240 ms</p>
            <p>Local: http://localhost:3000</p>
            <p class="appearance-preview__prompt">
              ${" "}
              <span
                class="appearance-preview__cursor"
                style={{ background: theme.cursor ?? theme.foreground }}
              />
            </p>
          </div>
        </div>
        {current.showStatusBar && <div class="appearance-preview__status">main · ~/project</div>}
      </div>
      <p class="appearance-preview__caption">
        {current.fontFamily} · {current.fontSize}px
      </p>
      <p class="appearance-preview__note">Changes apply as you choose them.</p>
    </aside>
  );
}
