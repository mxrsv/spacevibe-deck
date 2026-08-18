import { describe, expect, it, vi } from 'vitest';
import {
  createAgentNotifier,
  type AgentNotifierDeps,
  type AttentionNotification,
} from './agent-notifier';

function makeNotification(overrides: Partial<AttentionNotification> = {}): AttentionNotification {
  return {
    paneId: 1,
    revision: 1,
    kind: 'completed',
    workspaceLabel: 'my-workspace',
    agentLabel: 'claude-code',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AgentNotifierDeps> = {}): {
  deps: AgentNotifierDeps;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  const deps: AgentNotifierDeps = {
    isEnabled: () => true,
    isWindowFocused: () => false,
    send,
    ...overrides,
  };
  return { deps, send };
}

describe('createAgentNotifier', () => {
  it('does not notify while the window is focused, even for an actionable kind', () => {
    const { deps, send } = makeDeps({ isWindowFocused: () => true });
    const notifier = createAgentNotifier(deps);

    notifier.maybeNotify(makeNotification({ kind: 'error' }));

    expect(send).not.toHaveBeenCalled();
  });

  it('does not notify when agent notifications are disabled', () => {
    const { deps, send } = makeDeps({ isEnabled: () => false });
    const notifier = createAgentNotifier(deps);

    notifier.maybeNotify(makeNotification({ kind: 'warning' }));

    expect(send).not.toHaveBeenCalled();
  });

  it('notifies once when actionable, backgrounded, and enabled, with copy built from label + kind', () => {
    const { deps, send } = makeDeps();
    const notifier = createAgentNotifier(deps);

    notifier.maybeNotify(
      makeNotification({
        kind: 'completed',
        workspaceLabel: 'stackgrid',
        agentLabel: 'claude-code',
      }),
    );

    expect(send).toHaveBeenCalledOnce();
    const payload = send.mock.calls[0][0];
    expect(payload.title).toContain('stackgrid');
    expect(payload.body).toContain('claude-code');
    expect(payload.body).toContain('finished');
  });

  it.each([
    ['requested', 'needs attention'],
    ['warning', 'warning'],
    ['error', 'error'],
  ] as const)('uses the fixed phrase for kind=%s', (kind, phrase) => {
    const { deps, send } = makeDeps();
    const notifier = createAgentNotifier(deps);

    notifier.maybeNotify(makeNotification({ kind }));

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].body).toContain(phrase);
  });

  it("falls back to a generic 'Agent' label when agentLabel is null", () => {
    const { deps, send } = makeDeps();
    const notifier = createAgentNotifier(deps);

    notifier.maybeNotify(makeNotification({ kind: 'completed', agentLabel: null }));

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].body).toBe('Agent finished');
  });

  it("never notifies for the non-actionable 'none' kind", () => {
    const { deps, send } = makeDeps();
    const notifier = createAgentNotifier(deps);

    notifier.maybeNotify(makeNotification({ kind: 'none' }));

    expect(send).not.toHaveBeenCalled();
  });

  it('dedupes: a second call with the same (paneId, revision) does not re-fire', () => {
    const { deps, send } = makeDeps();
    const notifier = createAgentNotifier(deps);
    const n = makeNotification({ paneId: 7, revision: 3, kind: 'completed' });

    notifier.maybeNotify(n);
    notifier.maybeNotify(n); // re-render / next poll / next output — same revision

    expect(send).toHaveBeenCalledOnce();
  });

  it('fires again for a higher revision on the same pane', () => {
    const { deps, send } = makeDeps();
    const notifier = createAgentNotifier(deps);

    notifier.maybeNotify(makeNotification({ paneId: 7, revision: 3, kind: 'completed' }));
    notifier.maybeNotify(makeNotification({ paneId: 7, revision: 4, kind: 'requested' }));

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a transition suppressed by an earlier gate does not consume the dedupe slot', () => {
    const send = vi.fn();
    let enabled = false;
    const deps: AgentNotifierDeps = {
      isEnabled: () => enabled,
      isWindowFocused: () => false,
      send,
    };
    const notifier = createAgentNotifier(deps);
    const n = makeNotification({ paneId: 9, revision: 1, kind: 'completed' });

    notifier.maybeNotify(n); // disabled — suppressed, not recorded
    expect(send).not.toHaveBeenCalled();

    enabled = true;
    notifier.maybeNotify(n); // now eligible — same revision, should still fire

    expect(send).toHaveBeenCalledOnce();
  });

  it('prune drops dedupe state only for pruned panes; other panes stay independent', () => {
    const { deps, send } = makeDeps();
    const notifier = createAgentNotifier(deps);

    notifier.maybeNotify(makeNotification({ paneId: 1, revision: 1, kind: 'completed' }));
    notifier.maybeNotify(makeNotification({ paneId: 2, revision: 1, kind: 'completed' }));
    expect(send).toHaveBeenCalledTimes(2);

    // Pane 2 is no longer live — its dedupe state is dropped. Pane 1 stays.
    notifier.prune([1]);

    // Pane 1 is untouched by the prune: same revision stays deduped.
    notifier.maybeNotify(makeNotification({ paneId: 1, revision: 1, kind: 'completed' }));
    expect(send).toHaveBeenCalledTimes(2);

    // Pane 2's dedupe was cleared by prune — a fresh pane reusing the id (or
    // a stale re-poll) is independent of pane 1 and fires again.
    notifier.maybeNotify(makeNotification({ paneId: 2, revision: 1, kind: 'completed' }));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('builds the payload copy EXACTLY and ONLY from workspaceLabel + agentLabel + the fixed kind phrase', () => {
    const { deps, send } = makeDeps();
    const notifier = createAgentNotifier(deps);

    notifier.maybeNotify(
      makeNotification({
        kind: 'warning',
        workspaceLabel: 'my-workspace',
        agentLabel: 'claude-code',
      }),
    );

    expect(send).toHaveBeenCalledOnce();
    const payload = send.mock.calls[0][0];
    // Exact equality, not `.toContain` — this fails if the notifier ever
    // injects any extra/other content beyond the two labels + fixed phrase.
    expect(payload.title).toBe('my-workspace');
    expect(payload.body).toBe('claude-code warning');
  });

  it('carries an OSC-like string placed in workspaceLabel (an actual field) verbatim into the title, with nothing else appended', () => {
    // Unlike a string with no field to travel through, workspaceLabel is a
    // real, caller-controlled input — proving the notifier neither adds nor
    // mangles field content, and that raw text can only ever reach a
    // notification via a field the caller controls (Task 23 normalizes it).
    const oscLikeLabel = '\x1b]9;4;1;RAW_SECRET_PROGRESS_TEXT\x07';
    const { deps, send } = makeDeps();
    const notifier = createAgentNotifier(deps);

    notifier.maybeNotify(
      makeNotification({
        kind: 'completed',
        workspaceLabel: oscLikeLabel,
        agentLabel: 'claude-code',
      }),
    );

    expect(send).toHaveBeenCalledOnce();
    const payload = send.mock.calls[0][0];
    expect(payload.title).toBe(oscLikeLabel);
    expect(payload.body).toBe('claude-code finished');
  });

  it('does not fire for a revision lower than the last notified revision on that pane, and does not corrupt the stored high-water mark', () => {
    const { deps, send } = makeDeps();
    const notifier = createAgentNotifier(deps);

    // Notify at revision 5 first.
    notifier.maybeNotify(makeNotification({ paneId: 4, revision: 5, kind: 'completed' }));
    expect(send).toHaveBeenCalledOnce();

    // A lower, out-of-order revision must not fire.
    notifier.maybeNotify(makeNotification({ paneId: 4, revision: 4, kind: 'warning' }));
    expect(send).toHaveBeenCalledOnce();

    // If the lower revision had overwritten the stored value downward, a
    // repeat of revision 5 would now look "higher" and re-fire. It must not.
    notifier.maybeNotify(makeNotification({ paneId: 4, revision: 5, kind: 'completed' }));
    expect(send).toHaveBeenCalledOnce();
  });
});
