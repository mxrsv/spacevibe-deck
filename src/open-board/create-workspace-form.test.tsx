// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateWorkspaceForm, type CreateWorkspaceFormProps } from "./create-workspace-form";

let host: HTMLDivElement;

function mount(overrides: Partial<CreateWorkspaceFormProps> = {}) {
  const onCreated = vi.fn();
  const onBack = vi.fn();
  const create = vi.fn(async (parent: string, name: string) => ({ path: `${parent}/${name}` }));
  const props: CreateWorkspaceFormProps = {
    initialParent: "/repo",
    onPickParent: async () => "/picked",
    create,
    onCreated,
    onBack,
    ...overrides,
  };
  act(() => render(<CreateWorkspaceForm {...props} />, host));
  return { create, onCreated, onBack };
}

function inputName(value: string): void {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Folder name"]');
  if (input === null) throw new Error("missing folder name input");
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

describe("CreateWorkspaceForm", () => {
  it("keeps submit disabled until parent and name are valid", () => {
    mount({ initialParent: "" });
    const submit = host.querySelector<HTMLButtonElement>('[data-action="create-workspace"]');
    expect(submit?.disabled).toBe(true);
  });

  it.each([".hidden", "..", "../escape", "a/b", "a\\b"])(
    "rejects the unsafe name %j before IPC",
    async (name) => {
      const { create } = mount();
      inputName(name);
      host.querySelector<HTMLButtonElement>('[data-action="create-workspace"]')?.click();
      await act(async () => Promise.resolve());
      expect(create).not.toHaveBeenCalled();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("folder name");
    },
  );

  it("keeps the form open and reports a create failure", async () => {
    const create = vi.fn(async () => {
      throw new Error("already exists");
    });
    const result = mount({ create });
    inputName("deck-next");
    host.querySelector<HTMLButtonElement>('[data-action="create-workspace"]')?.click();
    await act(async () => Promise.resolve());
    expect(result.onCreated).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("already exists");
  });

  it("returns the created path to the parent surface", async () => {
    const { create, onCreated } = mount();
    inputName("deck-next");
    host.querySelector<HTMLButtonElement>('[data-action="create-workspace"]')?.click();
    await act(async () => Promise.resolve());
    expect(create).toHaveBeenCalledWith("/repo", "deck-next");
    expect(onCreated).toHaveBeenCalledWith("/repo/deck-next");
  });

  it("uses the native folder result as the parent", async () => {
    mount();
    host.querySelector<HTMLButtonElement>('[data-action="pick-parent"]')?.click();
    await act(async () => Promise.resolve());
    expect(host.querySelector("[data-parent-path]")?.textContent).toContain("/picked");
  });

  it("returns to the parent when Escape starts inside the name field", () => {
    const { onBack } = mount();
    host
      .querySelector<HTMLInputElement>('[aria-label="Folder name"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
