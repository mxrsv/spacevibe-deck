// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './modal';

let host: HTMLDivElement;

function scrim(): HTMLDivElement {
  return host.querySelector('.modal-scrim') as HTMLDivElement;
}

function panel(): HTMLDivElement {
  return host.querySelector('.demo-modal') as HTMLDivElement;
}

/** jsdom has no PointerEvent, and the component only reads `target`. */
function press(target: EventTarget): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
}

/** The other half of a real gesture — a browser always fires it before click. */
function release(target: EventTarget): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  });
}

function click(target: EventTarget): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function key(target: EventTarget, name: string, modifiers: { shiftKey?: boolean } = {}): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: name,
        bubbles: true,
        shiftKey: modifiers.shiftKey === true,
      }),
    );
  });
}

function mount(
  overrides: {
    dismissOnScrim?: boolean;
    initialFocus?: string;
    onKeyDown?: (event: KeyboardEvent) => void;
  } = {},
): { onDismiss: ReturnType<typeof vi.fn> } {
  const onDismiss = vi.fn();
  act(() => {
    render(
      <Modal
        panelClass="demo-modal"
        label="Demo"
        onDismiss={onDismiss}
        dismissOnScrim={overrides.dismissOnScrim}
        initialFocus={overrides.initialFocus}
        onKeyDown={overrides.onKeyDown}
      >
        <input class="demo-modal__field" />
        <button type="button" class="demo-modal__action">
          Act
        </button>
      </Modal>,
      host,
    );
  });
  return { onDismiss };
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

describe('Modal', () => {
  it('wraps its panel in the scrim and labels it as a dialog', () => {
    mount();

    expect(scrim().firstElementChild).toBe(panel());
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-modal')).toBe('true');
    expect(panel().getAttribute('aria-label')).toBe('Demo');
  });

  it('focuses the panel on mount so its keys work immediately', () => {
    mount();

    expect(document.activeElement).toBe(panel());
  });

  it('focuses initialFocus instead when one is given', () => {
    mount({ initialFocus: 'input' });

    expect(document.activeElement).toBe(host.querySelector('input'));
  });

  it('a press and release on the scrim dismisses', () => {
    const { onDismiss } = mount();

    press(scrim());
    release(scrim());
    click(scrim());

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // The other direction of the same rule: a sweep that STARTS on the scrim and
  // ends inside the panel also fires `click` on the scrim, so reading the
  // press alone threw away whatever the user had typed.
  it('a press on the scrim released inside the panel does NOT dismiss', () => {
    const { onDismiss } = mount();

    press(scrim());
    release(host.querySelector('.demo-modal__field') as HTMLInputElement);
    click(scrim());

    expect(onDismiss).not.toHaveBeenCalled();
  });

  // The reason dismissal tracks pointerdown rather than click alone: a drag
  // that starts inside the panel (a divider, a text selection) and ends
  // outside it fires `click` on the common ancestor, which IS the scrim.
  it('a press inside the panel released on the scrim does NOT dismiss', () => {
    const { onDismiss } = mount();

    press(panel());
    release(scrim());
    click(scrim());

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('clicking inside the panel does not dismiss', () => {
    const { onDismiss } = mount();
    const action = host.querySelector('.demo-modal__action') as HTMLButtonElement;

    press(panel());
    release(action);
    click(action);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('a second scrim press after an ignored drag still dismisses', () => {
    const { onDismiss } = mount();

    press(panel());
    release(scrim());
    click(scrim());
    press(scrim());
    release(scrim());
    click(scrim());

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismissOnScrim=false keeps the scrim inert', () => {
    const { onDismiss } = mount({ dismissOnScrim: false });

    press(scrim());
    release(scrim());
    click(scrim());

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Escape dismisses even when the scrim is inert', () => {
    const { onDismiss } = mount({ dismissOnScrim: false });

    key(panel(), 'Escape');

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("Escape is not passed on to the host's key handling", () => {
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    mount();

    key(panel(), 'Escape');

    document.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it("keys other than Escape reach the panel's own handler", () => {
    const onKeyDown = vi.fn();
    mount({ onKeyDown });

    key(panel(), '2');

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0][0].key).toBe('2');
  });

  it('does not swallow Escape raised inside a field of its own panel', () => {
    const { onDismiss } = mount({ initialFocus: 'input' });

    key(host.querySelector('input') as HTMLInputElement, 'Escape');

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // `aria-modal="true"` promises the rest of the app is inert. Without a trap
  // the first Shift+Tab walked out of the dialog into the stage strip and
  // landed in xterm's textarea, so every keystroke went to the running agent
  // while the modal was still on screen.
  it('Shift+Tab from the first stop wraps to the last, never out of the panel', () => {
    mount({ initialFocus: 'input' });
    const action = host.querySelector('.demo-modal__action') as HTMLButtonElement;

    key(host.querySelector('input') as HTMLInputElement, 'Tab', {
      shiftKey: true,
    });

    expect(document.activeElement).toBe(action);
  });

  it('Tab from the last stop wraps to the first', () => {
    mount({ initialFocus: '.demo-modal__action' });
    const field = host.querySelector('input') as HTMLInputElement;

    key(host.querySelector('.demo-modal__action') as HTMLButtonElement, 'Tab');

    expect(document.activeElement).toBe(field);
  });

  it('Tab from the panel itself stays inside the panel', () => {
    mount();

    key(panel(), 'Tab', { shiftKey: true });

    expect(panel().contains(document.activeElement)).toBe(true);
  });

  // Closing used to leave `document.activeElement` on `<body>`: the user could
  // not type into anything until they clicked a pane with the mouse.
  it('gives focus back to whatever held it when the modal opened', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    mount();
    expect(document.activeElement).toBe(panel());

    act(() => {
      render(null, host);
    });

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('leaves focus alone when the close already moved it somewhere real', () => {
    const opener = document.createElement('button');
    const elsewhere = document.createElement('button');
    document.body.append(opener, elsewhere);
    opener.focus();
    mount();

    // A modal that opens a tab hands focus to the new pane; restoring blindly
    // would yank it straight back out.
    act(() => {
      render(null, host);
      elsewhere.focus();
    });

    expect(document.activeElement).toBe(elsewhere);
    opener.remove();
    elsewhere.remove();
  });
});
