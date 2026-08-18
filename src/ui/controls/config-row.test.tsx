// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToggleRow } from './config-row';

describe('ToggleRow — disabled state (additive)', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  const mount = (checked: boolean, onToggle: () => void, disabled?: boolean): void => {
    act(() => {
      render(
        <ToggleRow label="wrap" checked={checked} onToggle={onToggle} disabled={disabled} />,
        host,
      );
    });
  };

  it('clicking calls onToggle when disabled is omitted (unchanged behavior)', () => {
    const onToggle = vi.fn();
    mount(false, onToggle);
    const button = host.querySelector('button') as HTMLButtonElement;

    act(() => {
      button.click();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('clicking calls onToggle when disabled={false}', () => {
    const onToggle = vi.fn();
    mount(false, onToggle, false);
    const button = host.querySelector('button') as HTMLButtonElement;

    act(() => {
      button.click();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // Uses the native `.click()` activation behavior (not a raw
  // dispatchEvent(new MouseEvent(...)), which bypasses the disabled check in
  // jsdom) so this actually exercises the browser's disabled enforcement.
  it('disabled={true} sets the native disabled attribute and blocks the click', () => {
    const onToggle = vi.fn();
    mount(true, onToggle, true);
    const button = host.querySelector('button') as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.hasAttribute('disabled')).toBe(true);

    act(() => {
      button.click();
    });

    expect(onToggle).not.toHaveBeenCalled();
  });

  it('keeps role=switch and aria-checked when disabled', () => {
    mount(true, vi.fn(), true);
    const button = host.querySelector('button') as HTMLButtonElement;

    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('wrap');
  });
});
