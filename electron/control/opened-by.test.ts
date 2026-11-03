import { describe, expect, it } from "vitest";
import { createOpenedBy } from "./opened-by";

const COORDINATOR = 1;
const WORKER = 2;
const STRANGER = 3;

function table() {
  const openedBy = createOpenedBy();
  openedBy.record(WORKER, COORDINATOR);
  return openedBy;
}

describe("opened-by scope table", () => {
  it("lets the opener send to, read, wait on and close the pane it opened", () => {
    const openedBy = table();
    for (const command of ["send", "read", "wait", "close"]) {
      expect(openedBy.mayAct(COORDINATOR, WORKER, command)).toBe(true);
    }
  });

  it("lets a pane read and wait on itself but never send to or close itself", () => {
    const openedBy = table();
    expect(openedBy.mayAct(COORDINATOR, COORDINATOR, "read")).toBe(true);
    expect(openedBy.mayAct(COORDINATOR, COORDINATOR, "wait")).toBe(true);
    expect(openedBy.mayAct(COORDINATOR, COORDINATOR, "send")).toBe(false);
    expect(openedBy.mayAct(COORDINATOR, COORDINATOR, "close")).toBe(false);
  });

  it("refuses a pane nobody here opened, and a worker acting on its opener", () => {
    const openedBy = table();
    for (const command of ["send", "read", "wait", "close"]) {
      expect(openedBy.mayAct(COORDINATOR, STRANGER, command)).toBe(false);
      expect(openedBy.mayAct(STRANGER, WORKER, command)).toBe(false);
      expect(openedBy.mayAct(WORKER, COORDINATOR, command)).toBe(false);
    }
  });

  it("refuses any command it does not scope", () => {
    const openedBy = table();
    for (const command of ["list", "open", "worktree", "", "SEND"]) {
      expect(openedBy.mayAct(COORDINATOR, WORKER, command)).toBe(false);
      expect(openedBy.mayAct(COORDINATOR, COORDINATOR, command)).toBe(false);
    }
  });

  it("forgets a record when the child ends", () => {
    const openedBy = table();
    openedBy.forget(WORKER);
    expect(openedBy.openedBy(COORDINATOR, WORKER)).toBe(false);
    expect(openedBy.mayAct(COORDINATOR, WORKER, "close")).toBe(false);
  });

  it("forgets every child when the opener ends, so a reused id inherits nothing", () => {
    const openedBy = table();
    openedBy.record(STRANGER, COORDINATOR);
    openedBy.forget(COORDINATOR);
    expect(openedBy.mayAct(COORDINATOR, WORKER, "send")).toBe(false);
    expect(openedBy.mayAct(COORDINATOR, STRANGER, "send")).toBe(false);
  });

  it("does not let a pane record itself as its own child", () => {
    const openedBy = createOpenedBy();
    openedBy.record(COORDINATOR, COORDINATOR);
    expect(openedBy.mayAct(COORDINATOR, COORDINATOR, "send")).toBe(false);
  });

  it("moves a pane to its new opener when an id is recorded again", () => {
    const openedBy = table();
    openedBy.record(WORKER, STRANGER);
    expect(openedBy.mayAct(COORDINATOR, WORKER, "send")).toBe(false);
    expect(openedBy.mayAct(STRANGER, WORKER, "send")).toBe(true);
  });
});
