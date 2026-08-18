/**
 * Usage snapshot, over the host bridge.
 *
 * The channel name matches the Tauri command this feature was ported from,
 * and the payload is empty by contract — the scan takes no renderer input.
 * `scripts/electron-ipc-contract.test.ts` carries the zero-payload fixture
 * that pins this shape (R6).
 */
import { invoke } from './bridge';
import type { UsageSnapshot } from '../lib/usage-snapshot';

export function usageSnapshot(): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>('usage_snapshot');
}
