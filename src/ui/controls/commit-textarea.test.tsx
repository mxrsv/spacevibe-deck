// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommitTextarea } from "./commit-textarea";

describe("CommitTextarea", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  const mount = (
    value: string,
    onCommit: (next: string) => void,
  ): HTMLTextAreaElement => {
    act(() =>
      render(
        <CommitTextarea
          value={value}
          placeholder="prompt body"
          ariaLabel="Body"
          onCommit={onCommit}
        />,
        host,
      ),
    );
    return host.querySelector("textarea") as HTMLTextAreaElement;
  };

  const type = (field: HTMLTextAreaElement, next: string): void => {
    act(() => {
      field.value = next;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("does not commit per keystroke", () => {
    const onCommit = vi.fn();
    const field = mount("old", onCommit);
    type(field, "new body");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the draft on blur", () => {
    const onCommit = vi.fn();
    const field = mount("old", onCommit);
    type(field, "new body");
    act(() => {
      field.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("new body");
  });

  it("commits on Cmd+Enter and leaves a bare Enter to the textarea", () => {
    const onCommit = vi.fn();
    const field = mount("old", onCommit);
    type(field, "line one");
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
    expect(onCommit).toHaveBeenCalledWith("line one");
  });

  it("reverts the draft on Escape without committing", () => {
    const onCommit = vi.fn();
    const field = mount("old", onCommit);
    type(field, "discarded");
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(field.value).toBe("old");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("adopts a value changed elsewhere, e.g. restore defaults", () => {
    const onCommit = vi.fn();
    mount("old", onCommit);
    act(() =>
      render(
        <CommitTextarea
          value="from the store"
          placeholder="prompt body"
          ariaLabel="Body"
          onCommit={onCommit}
        />,
        host,
      ),
    );
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "from the store",
    );
  });
});
