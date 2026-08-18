import { useEffect } from 'preact/hooks';
import { startUsagePolling, stopUsagePolling } from '../../usage/usage-store';
import { UsageBody } from './usage-body';

/**
 * Token usage as a tab of the docked side panel (DL-19.7).
 *
 * `UsageBody` is deliberately lifecycle-free — it renders whatever the store
 * holds — so whoever shows it owns the polling. The full-window screen used to
 * be that owner; this component is the dock's equivalent, and it exists as a
 * component rather than an effect inside `App` so the lifecycle is tied to the
 * tab being MOUNTED. Mount/unmount is exactly the transition that should start
 * and stop the poll: an effect keyed off settings would restart the poll on
 * every unrelated settings write.
 */
export function UsageDockTab() {
  useEffect(() => {
    startUsagePolling();
    return () => stopUsagePolling();
  }, []);

  return <UsageBody variant="dock" />;
}
