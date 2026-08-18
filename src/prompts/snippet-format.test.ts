import { describe, expect, it } from 'vitest';
import { composePromptText, formatAssetReference, isPromptAgentId } from './snippet-format';

describe('formatAssetReference', () => {
  it('phrases each cell of the per-CLI table', () => {
    expect(formatAssetReference('claude', 'skill', 'superpowers:brainstorming')).toBe(
      'Use the superpowers:brainstorming skill.',
    );
    expect(formatAssetReference('claude', 'subagent', 'plan-reviewer')).toBe(
      'Use the plan-reviewer subagent.',
    );
    expect(formatAssetReference('codex', 'skill', 'audit-5-layers')).toBe(
      'Use the audit-5-layers skill.',
    );
    expect(formatAssetReference('codex', 'subagent', 'plan-reviewer')).toBe(
      'Delegate to the plan-reviewer agent.',
    );
  });

  it('has no phrasing for an unverified CLI or an empty name', () => {
    expect(formatAssetReference('gemini', 'skill', 'x')).toBeNull();
    expect(formatAssetReference(null, 'skill', 'x')).toBeNull();
    expect(formatAssetReference('claude', 'skill', '  ')).toBeNull();
  });
});

describe('composePromptText', () => {
  it('returns the body untouched when nothing is picked', () => {
    expect(composePromptText('Fix it.\n', 'claude', [])).toBe('Fix it.\n');
  });

  it('appends one line per pick, in order', () => {
    expect(
      composePromptText('Fix it.', 'claude', [
        { kind: 'skill', name: 'code-review' },
        { kind: 'subagent', name: 'plan-reviewer' },
      ]),
    ).toBe('Fix it.\nUse the code-review skill.\nUse the plan-reviewer subagent.');
  });

  it("trims only the body's trailing whitespace before appending", () => {
    expect(
      composePromptText('Fix it.\n\n', 'claude', [{ kind: 'skill', name: 'code-review' }]),
    ).toBe('Fix it.\nUse the code-review skill.');
  });

  it('drops picks an unverified CLI has no phrasing for', () => {
    expect(composePromptText('Fix it.', 'gemini', [{ kind: 'skill', name: 'x' }])).toBe('Fix it.');
  });
});

describe('isPromptAgentId', () => {
  it('recognises exactly the two verified CLIs', () => {
    expect(isPromptAgentId('claude')).toBe(true);
    expect(isPromptAgentId('codex')).toBe(true);
    expect(isPromptAgentId('agy')).toBe(false);
    expect(isPromptAgentId(null)).toBe(false);
  });
});
