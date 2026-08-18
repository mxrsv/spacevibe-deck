// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommitInput } from './commit-input';

function type(input: HTMLInputElement, text: string): void {
  act(() => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CommitInput', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  const mount = (value: string, onCommit: (next: string) => void): void => {
    act(() => {
      render(<CommitInput value={value} placeholder="p" ariaLabel="a" onCommit={onCommit} />, host);
    });
  };

  const field = (): HTMLInputElement => host.querySelector('input') as HTMLInputElement;

  it('keeps the draft across a re-render — the settings panel never unmounts', () => {
    const onCommit = vi.fn();
    mount('Menlo', onCommit);
    type(field(), 'Iosev');

    // Any app re-render (closing the panel, a tab change) used to rewrite the
    // DOM value back to the stored one and wipe the draft.
    mount('Menlo', onCommit);

    expect(field().value).toBe('Iosev');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits the trimmed draft on blur', () => {
    const onCommit = vi.fn();
    mount('Menlo', onCommit);
    type(field(), '  Iosevka  ');

    act(() => {
      field().dispatchEvent(new Event('blur'));
    });

    expect(onCommit).toHaveBeenCalledWith('Iosevka');
  });

  it('commits on Enter', () => {
    const onCommit = vi.fn();
    mount('Menlo', onCommit);
    type(field(), 'Iosevka');

    act(() => {
      field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onCommit).toHaveBeenCalledWith('Iosevka');
  });

  it('does not commit an empty draft or an unchanged value', () => {
    const onCommit = vi.fn();
    mount('Menlo', onCommit);

    type(field(), '   ');
    act(() => {
      field().dispatchEvent(new Event('blur'));
    });
    type(field(), 'Menlo');
    act(() => {
      field().dispatchEvent(new Event('blur'));
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('adopts a value changed elsewhere (restore defaults)', () => {
    const onCommit = vi.fn();
    mount('Iosevka', onCommit);

    mount('SF Mono', onCommit);

    expect(field().value).toBe('SF Mono');
  });
});
