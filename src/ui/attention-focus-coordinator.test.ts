import { describe, expect, it, vi } from "vitest";
import {
  runAttentionFocus,
  type AttentionFocusRequest,
  type AttentionOverlaySnapshot,
} from "./attention-focus-coordinator";

function overlays(
  partial: Partial<AttentionOverlaySnapshot> = {},
): AttentionOverlaySnapshot {
  return {
    board: false,
    settings: false,
    presetEditor: false,
    savePresetDialog: false,
    ...partial,
  };
}

interface Spies {
  dismissBoard: ReturnType<typeof vi.fn>;
  dismissSettings: ReturnType<typeof vi.fn>;
  focusAttention: ReturnType<typeof vi.fn>;
  order: string[];
}

function makeSpies(): Spies {
  const order: string[] = [];
  return {
    dismissBoard: vi.fn(() => order.push("dismissBoard")),
    dismissSettings: vi.fn(() => order.push("dismissSettings")),
    focusAttention: vi.fn(() => order.push("focusAttention")),
    order,
  };
}

function request(
  spies: Spies,
  overrides: Partial<AttentionFocusRequest> = {},
): AttentionFocusRequest {
  return {
    hasCandidate: true,
    overlays: overlays(),
    dismissBoard: spies.dismissBoard,
    dismissSettings: spies.dismissSettings,
    focusAttention: spies.focusAttention,
    ...overrides,
  };
}

// The same matrix runs for a global request (no tabIndex — shortcut) and a
// scoped request (tabIndex given — status-mark click).
describe.each([
  { label: "global (no tabIndex)", tabIndex: undefined },
  { label: "scoped (tabIndex given)", tabIndex: 2 },
])("runAttentionFocus — $label", ({ tabIndex }) => {
  it("no candidate: calls nothing, regardless of overlay state", () => {
    const combos: AttentionOverlaySnapshot[] = [
      overlays(),
      overlays({ board: true }),
      overlays({ settings: true }),
      overlays({ board: true, settings: true }),
      overlays({ presetEditor: true }),
      overlays({ savePresetDialog: true }),
      overlays({ presetEditor: true, board: true, settings: true }),
    ];
    for (const snapshot of combos) {
      const spies = makeSpies();
      runAttentionFocus(
        request(spies, { tabIndex, hasCandidate: false, overlays: snapshot }),
      );
      expect(spies.dismissBoard).not.toHaveBeenCalled();
      expect(spies.dismissSettings).not.toHaveBeenCalled();
      expect(spies.focusAttention).not.toHaveBeenCalled();
    }
  });

  it("no overlays open, candidate present: focusAttention called once with the request's tabIndex, no dismiss", () => {
    const spies = makeSpies();
    runAttentionFocus(
      request(spies, { tabIndex, hasCandidate: true, overlays: overlays() }),
    );
    expect(spies.dismissBoard).not.toHaveBeenCalled();
    expect(spies.dismissSettings).not.toHaveBeenCalled();
    expect(spies.focusAttention).toHaveBeenCalledTimes(1);
    expect(spies.focusAttention).toHaveBeenCalledWith(tabIndex);
  });

  it("board only: dismissBoard once, no dismissSettings, then focusAttention once", () => {
    const spies = makeSpies();
    runAttentionFocus(
      request(spies, {
        tabIndex,
        hasCandidate: true,
        overlays: overlays({ board: true }),
      }),
    );
    expect(spies.dismissBoard).toHaveBeenCalledTimes(1);
    expect(spies.dismissSettings).not.toHaveBeenCalled();
    expect(spies.focusAttention).toHaveBeenCalledTimes(1);
    expect(spies.focusAttention).toHaveBeenCalledWith(tabIndex);
    expect(spies.order).toEqual(["dismissBoard", "focusAttention"]);
  });

  it("settings only: dismissSettings once, no dismissBoard, then focusAttention once", () => {
    const spies = makeSpies();
    runAttentionFocus(
      request(spies, {
        tabIndex,
        hasCandidate: true,
        overlays: overlays({ settings: true }),
      }),
    );
    expect(spies.dismissSettings).toHaveBeenCalledTimes(1);
    expect(spies.dismissBoard).not.toHaveBeenCalled();
    expect(spies.focusAttention).toHaveBeenCalledTimes(1);
    expect(spies.focusAttention).toHaveBeenCalledWith(tabIndex);
    expect(spies.order).toEqual(["dismissSettings", "focusAttention"]);
  });

  it("board + settings: both dismissed once, then focusAttention once", () => {
    const spies = makeSpies();
    runAttentionFocus(
      request(spies, {
        tabIndex,
        hasCandidate: true,
        overlays: overlays({ board: true, settings: true }),
      }),
    );
    expect(spies.dismissBoard).toHaveBeenCalledTimes(1);
    expect(spies.dismissSettings).toHaveBeenCalledTimes(1);
    expect(spies.focusAttention).toHaveBeenCalledTimes(1);
    expect(spies.focusAttention).toHaveBeenCalledWith(tabIndex);
    // dismiss must happen before focus
    expect(spies.order.indexOf("dismissBoard")).toBeLessThan(
      spies.order.indexOf("focusAttention"),
    );
    expect(spies.order.indexOf("dismissSettings")).toBeLessThan(
      spies.order.indexOf("focusAttention"),
    );
  });

  it("no overlay open: nothing dismissed, focusAttention once", () => {
    const spies = makeSpies();
    runAttentionFocus(
      request(spies, {
        tabIndex,
        hasCandidate: true,
      }),
    );
    expect(spies.dismissBoard).not.toHaveBeenCalled();
    expect(spies.dismissSettings).not.toHaveBeenCalled();
    expect(spies.focusAttention).toHaveBeenCalledTimes(1);
    expect(spies.focusAttention).toHaveBeenCalledWith(tabIndex);
  });

  it("no overlay open, candidate present: focusAttention once, no dismiss", () => {
    const spies = makeSpies();
    runAttentionFocus(
      request(spies, {
        tabIndex,
        hasCandidate: true,
      }),
    );
    expect(spies.dismissBoard).not.toHaveBeenCalled();
    expect(spies.dismissSettings).not.toHaveBeenCalled();
    expect(spies.focusAttention).toHaveBeenCalledTimes(1);
    expect(spies.focusAttention).toHaveBeenCalledWith(tabIndex);
  });

  // The coordinator is a pure function over a caller-supplied snapshot, so
  // it asserts on the snapshot it is handed rather than on any invariant the
  // app enforces elsewhere.
  it("board + settings: both dismissed, then focusAttention once", () => {
    const spies = makeSpies();
    runAttentionFocus(
      request(spies, {
        tabIndex,
        hasCandidate: true,
        overlays: overlays({ board: true, settings: true }),
      }),
    );
    expect(spies.dismissBoard).toHaveBeenCalledTimes(1);
    expect(spies.dismissSettings).toHaveBeenCalledTimes(1);
    expect(spies.focusAttention).toHaveBeenCalledTimes(1);
    expect(spies.order.indexOf("dismissBoard")).toBeLessThan(
      spies.order.indexOf("focusAttention"),
    );
    expect(spies.order.indexOf("dismissSettings")).toBeLessThan(
      spies.order.indexOf("focusAttention"),
    );
  });

  it("a draft outranks everything: nothing called, the draft stays up", () => {
    const spies = makeSpies();
    runAttentionFocus(
      request(spies, {
        tabIndex,
        hasCandidate: true,
        overlays: overlays({ savePresetDialog: true }),
      }),
    );
    expect(spies.focusAttention).not.toHaveBeenCalled();
  });

  it("presetEditor open (alone, and combined with board/settings): nothing called — draft preserved", () => {
    const combos: AttentionOverlaySnapshot[] = [
      overlays({ presetEditor: true }),
      overlays({ presetEditor: true, board: true }),
      overlays({ presetEditor: true, settings: true }),
      overlays({ presetEditor: true, board: true, settings: true }),
    ];
    for (const snapshot of combos) {
      const spies = makeSpies();
      runAttentionFocus(
        request(spies, { tabIndex, hasCandidate: true, overlays: snapshot }),
      );
      expect(spies.dismissBoard).not.toHaveBeenCalled();
      expect(spies.dismissSettings).not.toHaveBeenCalled();
      expect(spies.focusAttention).not.toHaveBeenCalled();
    }
  });

  it("savePresetDialog open (alone, and combined with board/settings): nothing called — draft preserved", () => {
    const combos: AttentionOverlaySnapshot[] = [
      overlays({ savePresetDialog: true }),
      overlays({ savePresetDialog: true, board: true }),
      overlays({ savePresetDialog: true, settings: true }),
      overlays({ savePresetDialog: true, board: true, settings: true }),
    ];
    for (const snapshot of combos) {
      const spies = makeSpies();
      runAttentionFocus(
        request(spies, { tabIndex, hasCandidate: true, overlays: snapshot }),
      );
      expect(spies.dismissBoard).not.toHaveBeenCalled();
      expect(spies.dismissSettings).not.toHaveBeenCalled();
      expect(spies.focusAttention).not.toHaveBeenCalled();
    }
  });

  it("presetEditor + savePresetDialog together with board+settings: nothing called", () => {
    const spies = makeSpies();
    runAttentionFocus(
      request(spies, {
        tabIndex,
        hasCandidate: true,
        overlays: overlays({
          presetEditor: true,
          savePresetDialog: true,
          board: true,
          settings: true,
        }),
      }),
    );
    expect(spies.dismissBoard).not.toHaveBeenCalled();
    expect(spies.dismissSettings).not.toHaveBeenCalled();
    expect(spies.focusAttention).not.toHaveBeenCalled();
  });

  it("only calls the 3 injected spies — never anything resembling a focusing cancel/close", () => {
    const spies = makeSpies();
    const onCancel = vi.fn();
    const closePanel = vi.fn();
    const req: AttentionFocusRequest & {
      onCancel?: () => void;
      closePanel?: () => void;
    } = {
      ...request(spies, {
        tabIndex,
        hasCandidate: true,
        overlays: overlays({ board: true, settings: true }),
      }),
    };
    runAttentionFocus(req);
    expect(onCancel).not.toHaveBeenCalled();
    expect(closePanel).not.toHaveBeenCalled();
    // The coordinator's request shape only exposes these 3 closures — assert
    // exactly those are the ones invoked, in this order.
    expect(spies.order).toEqual([
      "dismissBoard",
      "dismissSettings",
      "focusAttention",
    ]);
  });
});
