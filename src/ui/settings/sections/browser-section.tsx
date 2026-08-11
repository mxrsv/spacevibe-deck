import { settings, updateSettings } from "../../../settings/settings-store";
import { ConfigRow } from "../../controls/config-row";
import { CommitInput } from "../../controls/commit-input";

/**
 * The browser panel's one persistent choice.
 *
 * The panel's width is set by dragging its seam, and everything else about it
 * is transient. What is NOT discoverable anywhere else is the address it opens
 * on: a dev server's port is the one thing every project has and no two share,
 * so leaving it as a constant meant a user on :5173 got :3000 every time with
 * no way to change it short of editing the store by hand.
 */
export function BrowserSection() {
  const current = settings.value;

  return (
    <ConfigRow
      label="home address"
      desc="opened when the browser panel has no page yet"
    >
      <CommitInput
        value={current.browserHomeUrl}
        placeholder="http://localhost:3000"
        ariaLabel="Browser home address"
        onCommit={(browserHomeUrl) => updateSettings({ browserHomeUrl })}
      />
    </ConfigRow>
  );
}
