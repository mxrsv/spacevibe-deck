/**
 * The Rust suite's four cases, translated rather than re-invented — the
 * migration design asks pure-logic ports to arrive with their original test
 * cases (§12). `src-tauri/src/update_flight.rs` is the other half.
 */
import { describe, expect, it } from "vitest";
import { UpdateFlight } from "./update-flight";

describe("UpdateFlight", () => {
  it("lets only one window check at a time", () => {
    const flight = new UpdateFlight();

    expect(flight.tryBegin("main")).toBe(true);
    expect(flight.tryBegin("deck-1")).toBe(false);
  });

  it("releases to the holder, and the next window may check", () => {
    const flight = new UpdateFlight();
    flight.tryBegin("main");

    expect(flight.finish("deck-1")).toBe(false);
    expect(flight.finish("main")).toBe(true);
    expect(flight.tryBegin("deck-1")).toBe(true);
  });

  it("does not let a dead holder block every later check", () => {
    // The whole reason this replaced a boolean: a window that dies between
    // begin and end used to disable the automatic check for the life of the
    // process, and nothing said so.
    const flight = new UpdateFlight();
    flight.tryBegin("deck-1");
    flight.forget("deck-1");

    expect(flight.tryBegin("main")).toBe(true);
  });

  it("changes nothing when a window that is not the holder is forgotten", () => {
    const flight = new UpdateFlight();
    flight.tryBegin("main");
    flight.forget("deck-1");

    expect(flight.tryBegin("deck-1")).toBe(false);
  });
});
