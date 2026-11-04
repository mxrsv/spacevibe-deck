import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ui/rail-add-folder", () => ({ rememberOnRail: vi.fn() }));

import { rememberOnRail } from "../ui/rail-add-folder";
import { cloneFinished, dropIntoStageLauncher } from "./stage-launcher-flows";
import { closeStageForm, openStageForm, stageForm } from "./stage-launcher-form-store";

beforeEach(() => closeStageForm());
afterEach(() => vi.clearAllMocks());

describe("dropIntoStageLauncher", () => {
  it("puts every dropped folder on the rail, the first-listed newest, and aims at it", () => {
    const show = vi.fn();

    dropIntoStageLauncher("/a", ["/a", "/b", "/c"], show);

    expect(vi.mocked(rememberOnRail).mock.calls.map(([path]) => path)).toEqual(["/c", "/b", "/a"]);
    expect(show).toHaveBeenCalledExactlyOnceWith("/a");
  });

  it("gives way to a form that was up", () => {
    openStageForm("clone");

    dropIntoStageLauncher("/a", ["/a"], vi.fn());

    expect(stageForm.value).toBeNull();
  });
});

describe("cloneFinished", () => {
  const actions = () => ({ aim: vi.fn(), leaveForm: vi.fn() });

  it("leaves the open Clone form for the launcher, aimed at the clone", () => {
    openStageForm("clone");
    const a = actions();

    cloneFinished("/clone", false, a);

    expect(a.leaveForm).toHaveBeenCalledExactlyOnceWith("/clone");
    expect(a.aim).not.toHaveBeenCalled();
  });

  it("keeps the form up for a warning to be read, and aims the bar", () => {
    openStageForm("clone");
    const a = actions();

    cloneFinished("/clone", true, a);

    expect(a.leaveForm).not.toHaveBeenCalled();
    expect(a.aim).toHaveBeenCalledExactlyOnceWith("/clone");
  });

  it("only aims the bar when the form was closed before the clone ended", () => {
    const a = actions();

    cloneFinished("/clone", false, a);

    expect(a.leaveForm).not.toHaveBeenCalled();
    expect(a.aim).toHaveBeenCalledExactlyOnceWith("/clone");
  });
});
