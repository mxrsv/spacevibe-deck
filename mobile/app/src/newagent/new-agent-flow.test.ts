import { describe, expect, it } from "vitest";
import { MAX_SEND_CHARS } from "@protocol/limits";
import { RpcError } from "@/session/rpc";
import {
  canStart,
  initialNewAgent,
  nextStep,
  openErrorText,
  openParams,
  promptToSend,
  reduceNewAgent,
  type NewAgentState,
} from "./new-agent-flow";

const complete = (state: NewAgentState): NewAgentState =>
  [
    { t: "checkout", projectPath: "/p", checkoutPath: "/p/wt" } as const,
    { t: "agent", id: "claude" } as const,
  ].reduce(reduceNewAgent, state);

describe("new agent flow", () => {
  it("skips the desktop step with one online desktop or an online preset", () => {
    expect(nextStep(initialNewAgent(["a"], null))).toBe("checkout");
    expect(nextStep(initialNewAgent(["a", "b"], null))).toBe("desktop");
    expect(initialNewAgent(["a", "b"], "b").desktopId).toBe("b");
    expect(initialNewAgent(["a", "b"], "offline").desktopId).toBeNull();
    expect(nextStep(initialNewAgent([], null))).toBe("desktop");
  });

  it("walks desktop, checkout, agent, then is ready", () => {
    let state = initialNewAgent(["a", "b"], null);
    expect(nextStep(state)).toBe("desktop");
    state = reduceNewAgent(state, { t: "desktop", id: "a" });
    expect(nextStep(state)).toBe("checkout");
    state = reduceNewAgent(state, { t: "checkout", projectPath: "/p", checkoutPath: "/p" });
    expect(nextStep(state)).toBe("agent");
    state = reduceNewAgent(state, { t: "agent", id: "codex" });
    expect(nextStep(state)).toBe("ready");
    expect(canStart(state)).toBe(true);
  });

  it("forgets checkout and agent when another desktop is chosen, keeps the prompt", () => {
    let state = complete(initialNewAgent(["a", "b"], "a"));
    state = reduceNewAgent(state, { t: "prompt", text: "fix the tests" });
    state = reduceNewAgent(state, { t: "desktop", id: "b" });
    expect(state).toMatchObject({
      desktopId: "b",
      checkoutPath: null,
      agent: null,
      prompt: "fix the tests",
    });
    expect(reduceNewAgent(state, { t: "desktop", id: "b" })).toBe(state);
  });

  it("never puts the prompt in pane.open, and hands it over separately", () => {
    const state = complete(initialNewAgent(["a"], null));
    expect(openParams(state)).toEqual({
      projectPath: "/p",
      checkoutPath: "/p/wt",
      agent: "claude",
      prompt: null,
    });
    const withPrompt = reduceNewAgent(state, { t: "prompt", text: "  review the relay  " });
    expect(openParams(withPrompt)?.prompt).toBeNull();
    expect(promptToSend(withPrompt)).toBe("  review the relay  ");
    expect(promptToSend(state)).toBeNull();
    expect(promptToSend(reduceNewAgent(state, { t: "prompt", text: "   " }))).toBeNull();
    expect(openParams(initialNewAgent(["a"], null))).toBeNull();
  });

  it("caps the prompt at the protocol limit", () => {
    const state = reduceNewAgent(initialNewAgent(["a"], null), {
      t: "prompt",
      text: "x".repeat(MAX_SEND_CHARS + 50),
    });
    expect(state.prompt).toHaveLength(MAX_SEND_CHARS);
  });

  it("does not start twice, and a failure returns to a startable state with its message", () => {
    let state = complete(initialNewAgent(["a"], null));
    state = reduceNewAgent(state, { t: "start" });
    expect(state.phase).toBe("starting");
    expect(canStart(state)).toBe(false);
    expect(reduceNewAgent(state, { t: "start" })).toBe(state);
    state = reduceNewAgent(state, { t: "failed", message: "nope" });
    expect(state).toMatchObject({ phase: "failed", error: "nope" });
    expect(canStart(state)).toBe(true);
    expect(reduceNewAgent(initialNewAgent(["a"], null), { t: "start" }).phase).toBe("editing");
  });
});

describe("openErrorText", () => {
  it("names what to do for each failure", () => {
    expect(openErrorText(new RpcError("outside-root", "x"))).toMatch(/not one of Deck's projects/);
    expect(openErrorText(new RpcError("not-found", "x"))).toMatch(/agent may not be enabled/);
    expect(openErrorText(new RpcError("timeout", "x"))).toMatch(/did not answer in time/);
    expect(openErrorText(new RpcError("not-connected", "x"))).toMatch(/Not connected/);
    expect(openErrorText(new RpcError("unavailable", "Deck has no window open"))).toBe(
      "Deck has no window open.",
    );
    expect(openErrorText(new Error("boom"))).toMatch(/Try again/);
  });
});
