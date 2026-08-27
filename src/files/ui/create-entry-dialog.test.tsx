// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEntryDialog } from "./create-entry-dialog";
import { createEntryRequest } from "../../chrome/events";
import type { EntryKind } from "../../host/file-create-host";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createEntryRequest.value = null;
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  createEntryRequest.value = null;
});

interface Request {
  readonly workspacePath: string;
  readonly parent: string;
  readonly kind: EntryKind;
}

function mountDialog(request: Request, onCreate = vi.fn(async () => true)): typeof onCreate {
  createEntryRequest.value = request;
  act(() => {
    render(
      <CreateEntryDialog
        workspacePath={request.workspacePath}
        parent={request.parent}
        kind={request.kind}
        onCancel={() => {
          createEntryRequest.value = null;
        }}
        onCreate={onCreate}
      />,
      host,
    );
  });
  return onCreate;
}

function field(): HTMLInputElement {
  return host.querySelector("input") as HTMLInputElement;
}

function confirmButton(): HTMLButtonElement {
  return host.querySelector(".is-primary") as HTMLButtonElement;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string): Promise<void> {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("CreateEntryDialog", () => {
  it("names its destination and refuses an invalid name before main sees it", async () => {
    mountDialog({ workspacePath: "/r", parent: "/r/src", kind: "file" });
    expect(host.querySelector(".create-entry__destination")?.textContent).toContain("src");

    expect(confirmButton().disabled).toBe(true); // empty
    await type(field(), "a/b");
    expect(confirmButton().disabled).toBe(true);
    expect(host.querySelector(".create-entry__reason")?.textContent).toBe(
      "A name can't contain a path separator.",
    );
    await type(field(), "notes.md");
    expect(confirmButton().disabled).toBe(false);
    expect(host.querySelector(".create-entry__reason")).toBeNull();
  });

  it("accepts a leading dot", async () => {
    mountDialog({ workspacePath: "/r", parent: "/r", kind: "directory" });
    await type(field(), ".github");
    expect(confirmButton().disabled).toBe(false);
  });

  it("takes focus on mount, confirms on Enter and closes either way", async () => {
    const onCreate = mountDialog({ workspacePath: "/r", parent: "/r", kind: "file" });
    expect(document.activeElement?.tagName).toBe("INPUT");

    await type(field(), "a.ts");
    await press("Enter");

    expect(onCreate).toHaveBeenCalledWith("/r", "/r", "a.ts", "file");
    expect(createEntryRequest.value).toBeNull();
  });

  it("closes on a failure too — the status line owns the reason (design §5.4)", async () => {
    mountDialog(
      { workspacePath: "/r", parent: "/r", kind: "file" },
      vi.fn(async () => false),
    );

    await type(field(), "taken.md");
    await press("Enter");

    expect(createEntryRequest.value).toBeNull();
  });
});
