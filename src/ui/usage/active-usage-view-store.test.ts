import { describe, expect, it } from 'vitest';
import { activeUsageView } from './active-usage-view-store';

describe('activeUsageView', () => {
  it('defaults to overview', () => {
    expect(activeUsageView.value).toBe('overview');
  });

  it('sticks when assigned', () => {
    activeUsageView.value = 'daily';
    expect(activeUsageView.value).toBe('daily');

    activeUsageView.value = 'breakdown';
    expect(activeUsageView.value).toBe('breakdown');

    activeUsageView.value = 'overview';
  });
});
