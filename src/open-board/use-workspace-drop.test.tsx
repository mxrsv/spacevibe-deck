// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../host/bridge";
import { useWorkspaceDrop } from "./use-workspace-drop";

vi.mock("../host/bridge", () => ({ invoke: vi.fn() }));
const select = vi.fn<(path: string) => Promise<void>>();
const error = vi.fn();
let host: HTMLDivElement;

function Surface({ enabled = true }: { enabled?: boolean }) {
  const drop = useWorkspaceDrop({ enabled, onSelect: select, onError: error });
  return (
    <div {...drop.handlers} data-drop data-dragging={drop.dragging}>
      <button disabled={drop.checking}>Run</button>
    </div>
  );
}

function dispatch(type: string, names = ["/work/My Folder"], types = ["Files"]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types,
      files: names.map((name) => new File([], name)),
      dropEffect: "none",
    },
  });
  host.querySelector("[data-drop]")!.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("__deckHost", {
    getPathForFile: (file: File) => file.name,
    grantDroppedWorkspace: vi.fn().mockResolvedValue(true),
  });
  vi.mocked(invoke).mockResolvedValue([true]);
  select.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => render(<Surface />, host));
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

describe("workspace folder drop", () => {
  it("validates one folder and selects its full path without launching", async () => {
    await act(async () => {
      dispatch("drop");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invoke).toHaveBeenCalledWith("dirs_exist", { paths: ["/work/My Folder"] });
    expect(select).toHaveBeenCalledExactlyOnceWith("/work/My Folder");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("button")?.disabled).toBe(false);
    expect(error).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("blocks Run and duplicate drops until directory validation answers", async () => {
    let resolve!: (flags: boolean[]) => void;
    vi.mocked(invoke).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    act(() => {
      dispatch("drop");
    });
    expect(host.querySelector("button")?.disabled).toBe(true);
    await act(async () => {
      dispatch("drop", ["/other"]);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    await act(async () => {
      resolve([true]);
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(select).toHaveBeenCalledExactlyOnceWith("/work/My Folder");
  });

  it.each([{ names: [] }, { names: ["/one", "/two"] }])(
    "rejects an invalid entry count: $names",
    async ({ names }) => {
      await act(async () => {
        dispatch("drop", names);
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith("Drop one folder at a time.");
    },
  );

  it("rejects files or missing directories without changing the workspace", async () => {
    vi.mocked(invoke).mockResolvedValue([false]);
    await act(async () => {
      dispatch("drop", ["/work/file.txt"]);
    });
    expect(select).not.toHaveBeenCalled();
    expect(error).toHaveBeenLastCalledWith("Drop an existing folder, not a file.");
  });

  it("explains a missing native path", async () => {
    vi.stubGlobal("__deckHost", { getPathForFile: () => "" });
    await act(async () => {
      dispatch("drop");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(error).toHaveBeenLastCalledWith("Couldn't read that folder — use Open folder instead.");
  });

  it.each([null, [], ["true"], [true, false]].map((flags) => ({ flags })))(
    "fails closed on malformed host data: $flags",
    async ({ flags }) => {
      vi.mocked(invoke).mockResolvedValue(flags);
      await act(async () => {
        dispatch("drop");
      });
      expect(select).not.toHaveBeenCalled();
      expect(error).toHaveBeenLastCalledWith(
        "Couldn't open that folder — try again or use Open folder.",
      );
      expect(host.querySelector("button")?.disabled).toBe(false);
    },
  );

  it("reports a failed host call and allows retry", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      dispatch("drop");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(select).not.toHaveBeenCalled();
    expect(error).toHaveBeenLastCalledWith(
      "Couldn't open that folder — try again or use Open folder.",
    );
    await act(async () => {
      dispatch("drop");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it.each(["unmount", "disable"])("ignores an in-flight answer after %s", async (change) => {
    let resolve!: (flags: boolean[]) => void;
    vi.mocked(invoke).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    act(() => {
      dispatch("drop");
    });
    act(() => render(change === "unmount" ? null : <Surface enabled={false} />, host));
    await act(async () => {
      resolve([true]);
    });
    expect(select).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("ignores text and consumes file drops while unavailable", async () => {
    await act(async () => {
      dispatch("drop", [], ["text/plain"]);
    });
    act(() => render(<Surface enabled={false} />, host));
    let event!: Event;
    await act(async () => {
      event = dispatch("drop");
    });
    expect(event.defaultPrevented).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("leaves drops alone on a host that cannot resolve paths", async () => {
    vi.stubGlobal("__deckHost", undefined);
    const over = dispatch("dragover");
    let dropped!: Event;
    await act(async () => {
      dropped = dispatch("drop");
    });
    expect(over.defaultPrevented).toBe(false);
    expect(dropped.defaultPrevented).toBe(false);
    expect(host.querySelector("[data-drop]")?.getAttribute("data-dragging")).toBe("false");
    expect(invoke).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("clears the drop highlight after leaving or dropping", async () => {
    act(() => {
      dispatch("dragover");
    });
    expect(host.querySelector("[data-drop]")?.getAttribute("data-dragging")).toBe("true");
    act(() => {
      dispatch("dragleave");
    });
    expect(host.querySelector("[data-drop]")?.getAttribute("data-dragging")).toBe("false");
    await act(async () => {
      dispatch("dragover");
      dispatch("drop");
    });
    expect(host.querySelector("[data-drop]")?.getAttribute("data-dragging")).toBe("false");
  });
});
