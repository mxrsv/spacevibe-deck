/** Translated from `pane_census.rs` and `quit_flow.rs`. */
import { describe, expect, it } from "vitest";
import { allIdle, censusFor, CloseFlight, QuitFlight } from "./quit-flow";
import type { PtyInfo } from "./pty/info";

const pane = (id: number, kind: PtyInfo["kind"], process: string | null = null): PtyInfo => ({
  id,
  cwd: null,
  process,
  kind,
  agent: null,
});

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

describe("CloseFlight", () => {
  it("lets two windows prompt at the same time", () => {
    // Sharing the app-wide QuitFlight meant the second window's close was
    // prevented with no dialog and no message.
    const flight = new CloseFlight();

    expect(flight.tryBegin("main")).not.toBe(null);
    expect(flight.tryBegin("deck-1")).not.toBe(null);
  });

  it("admits one prompt per window", () => {
    const flight = new CloseFlight();
    flight.tryBegin("main");

    expect(flight.tryBegin("main")).toBe(null);
  });

  it("refuses a reply aimed at a different window", () => {
    // Close and quit ids come from different counters; without the label check
    // an id valid for one path would answer the other.
    const flight = new CloseFlight();
    const id = flight.tryBegin("main")!;

    expect(flight.take("deck-1", id)).toBe(false);
    expect(flight.take("main", id)).toBe(true);
  });

  it("refuses a stale id so an old reply cannot close a kept window", () => {
    const flight = new CloseFlight();
    const first = flight.tryBegin("main")!;
    flight.take("main", first);
    flight.tryBegin("main");

    expect(flight.take("main", first)).toBe(false);
  });

  it("releases the prompt when the window goes away", () => {
    const flight = new CloseFlight();
    flight.tryBegin("main");

    flight.forget("main");

    expect(flight.tryBegin("main")).not.toBe(null);
  });
});
