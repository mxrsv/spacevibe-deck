// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneAgent } from '../lib/process-info';
import { IDLE_ATTENTION_SUMMARY } from '../terminal/tabs-store';
import type { RailTab } from '../repositories/repository-model';
import { WorktreeAgentStack } from './worktree-agent-stack';

function tab(key: number, agents: readonly PaneAgent[], active = false): RailTab {
  return {
    index: key - 1,
    key,
    label: `Tab ${key}`,
    customName: null,
    workspacePath: '/repo/main',
    active,
    agents,
    attention: IDLE_ATTENTION_SUMMARY,
    agentBusy: false,
    unread: false,
  };
}

describe('WorktreeAgentStack', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it('renders nothing when the worktree has no tabs', () => {
    render(<WorktreeAgentStack tabs={[]} onSelectTab={() => {}} />, host);
    expect(host.childElementCount).toBe(0);
  });

  it('renders one button per tab and focuses the exact tab', () => {
    const onSelectTab = vi.fn();
    render(
      <WorktreeAgentStack
        tabs={[tab(1, ['claude']), tab(2, ['codex']), tab(3, ['Review Bot'], true)]}
        onSelectTab={onSelectTab}
      />,
      host,
    );

    expect(host.querySelectorAll('.worktree-agents__logo')).toHaveLength(2);
    expect(host.querySelector('.worktree-agents__letter')?.textContent).toBe('R');
    const buttons = host.querySelectorAll<HTMLButtonElement>('.worktree-agents__item');
    expect(buttons).toHaveLength(3);
    expect(buttons[2].getAttribute('aria-current')).toBe('page');

    act(() => {
      buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenCalledWith(1);
  });

  it('keeps duplicate agent tabs as separate buttons', () => {
    render(
      <WorktreeAgentStack
        tabs={[tab(1, ['claude']), tab(2, ['claude'], true)]}
        onSelectTab={() => {}}
      />,
      host,
    );

    expect(host.querySelectorAll('.worktree-agents__item')).toHaveLength(2);
    expect(host.querySelectorAll('.worktree-agents__logo')).toHaveLength(2);
  });

  it('keeps the active tab visible and exposes hidden tabs through +N', () => {
    const onSelectTab = vi.fn();
    render(
      <WorktreeAgentStack
        tabs={[
          tab(1, ['claude']),
          tab(2, ['codex']),
          tab(3, ['gemini']),
          tab(4, ['opencode'], true),
          tab(5, ['agy']),
        ]}
        onSelectTab={onSelectTab}
      />,
      host,
    );

    expect(host.querySelectorAll('.worktree-agents__item')).toHaveLength(3);
    const more = host.querySelector<HTMLButtonElement>('.worktree-agents__more');
    expect(more?.textContent).toBe('+2');

    act(() => {
      more?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const hidden = host.querySelectorAll<HTMLButtonElement>('.worktree-agents__menu-item');
    expect(hidden).toHaveLength(2);

    act(() => {
      hidden[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenCalledWith(0);
    expect(host.querySelector('.worktree-agents__menu')).toBeNull();
  });
});
