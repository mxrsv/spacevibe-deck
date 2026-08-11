/** Translated from `pane_census.rs` and `quit_flow.rs`. */
import { describe, expect, it } from "vitest";
import { allIdle, censusFor, QuitFlight } from "./quit-flow";
import type { PtyInfo } from "./pty/info";

const pane = (
  id: number,
  kind: PtyInfo["kind"],
  process: string | null = null,
): PtyInfo => ({ id, cwd: null, process, kind, agent: null });

describe("allIdle", () => {
  it("is true only when every pane is an idle shell", () => {
    expect(allIdle([pane(1, "idle-shell", "zsh")])).toBe(true);
    expect(allIdle([pane(1, "idle-shell", "zsh"), pane(2, "agent", "claude")])).toBe(false);
  });

  it("treats an unclassified pane as not idle", () => {
    // An unknown pane must still prompt: skipping the dialog would kill it.
    expect(allIdle([pane(1, "unknown")])).toBe(false);
  });
});

describe("censusFor", () => {
  it("counts panes but dedupes names", () => {
    const census = censusFor(7, [
      pane(1, "agent", "claude"),
      pane(2, "agent", "claude"),
      pane(3, "busy", "git"),
      pane(4, "idle-shell", "zsh"),
    ]);

    expect(census.requestId).toBe(7);
    expect(census.busyProcesses).toEqual(["claude", "git"]);
    expect(census.busyPanes).toBe(3);
    expect(census.fullyNamed).toBe(true);
  });

  it("reports not-fully-named when a pane is unclassified", () => {
    const census = censusFor(1, [pane(1, "agent", "claude"), pane(2, "unknown")]);

    expect(census.fullyNamed).toBe(false);
  });

  it("reports not-fully-named when a busy pane has no process name", () => {
    expect(censusFor(1, [pane(1, "busy", null)]).fullyNamed).toBe(false);
  });
});

describe("QuitFlight", () => {
  it("admits one prompt at a time", () => {
    const flight = new QuitFlight();

    expect(flight.tryBegin("main")).toBe(1);
    expect(flight.tryBegin("deck-2")).toBe(null);
  });

  it("rejects a stale reply so it cannot cancel the current prompt", () => {
    const flight = new QuitFlight();
    const first = flight.tryBegin("main")!;
    flight.finish(first);
    const second = flight.tryBegin("main");

    expect(flight.finish(first)).toBe(false);
    expect(flight.holder()).toBe("main");
    expect(second).toBe(2);
  });

  it("releases the prompt when the window holding it dies", () => {
    const flight = new QuitFlight();
    flight.tryBegin("deck-2");

    expect(flight.forgetWindow("main")).toBe(false);
    expect(flight.forgetWindow("deck-2")).toBe(true);
    expect(flight.tryBegin("main")).not.toBe(null);
  });
});
