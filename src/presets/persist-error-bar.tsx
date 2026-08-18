import { useEffect } from 'preact/hooks';
import { persistError } from '../chrome/events';

const AUTO_DISMISS_MS = 6000;

/** Surfaces an otherwise-silent background failure — store.set/save()
 * (presets, workspaces recents, settings) and PTY input writes — so the
 * user knows a change may not have landed. */
export function PersistErrorBar() {
  /* oxlint-disable react-hooks/exhaustive-deps -- Preact signal: persistError.value is the reactive dep (a new error re-arms the timer) */
  useEffect(() => {
    if (persistError.value === null) {
      return;
    }
    const timer = setTimeout(() => {
      persistError.value = null;
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [persistError.value]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  if (persistError.value === null) {
    return null;
  }
  return (
    <div class="persist-error-bar">
      <span>⚠ {persistError.value}</span>
      <button onClick={() => (persistError.value = null)}>Dismiss</button>
    </div>
  );
}
