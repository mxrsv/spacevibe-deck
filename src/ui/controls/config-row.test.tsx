// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { SETTINGS_REGISTRY } from "../../settings/settings-registry";
import { ConfigRow, ToggleRow } from "./config-row";

describe("ToggleRow — disabled state (additive)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  const mount = (checked: boolean, onToggle: () => void, disabled?: boolean): void => {
    act(() => {
      render(
        <ToggleRow label="wrap" checked={checked} onToggle={onToggle} disabled={disabled} />,
        host,
      );
    });
  };

  it("clicking calls onToggle when disabled is omitted (unchanged behavior)", () => {
    const onToggle = vi.fn();
    mount(false, onToggle);
    const button = host.querySelector<HTMLElement>('[role="switch"]')!;

    act(() => {
      button.click();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("clicking calls onToggle when disabled={false}", () => {
    const onToggle = vi.fn();
    mount(false, onToggle, false);
    const button = host.querySelector<HTMLElement>('[role="switch"]')!;

    act(() => {
      button.click();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // Uses the native `.click()` activation behavior (not a raw
  // dispatchEvent(new MouseEvent(...)), which bypasses the disabled check in
  // jsdom) so this actually exercises the browser's disabled enforcement.
  it("disabled={true} marks the switch disabled and blocks the click", () => {
    const onToggle = vi.fn();
    mount(true, onToggle, true);
    const button = host.querySelector<HTMLElement>('[role="switch"]')!;

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("data-disabled")).toBe(true);

    act(() => {
      button.click();
    });

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("renders a note in the key column and leaves the value slot with its one switch", () => {
    act(() => {
      render(
        <ToggleRow label="wrap" checked={false} onToggle={vi.fn()} note={<a href="#x">Get</a>} />,
        host,
      );
    });
    expect(host.querySelector(".cfg-row__key .cfg-row__note a")?.textContent).toBe("Get");
    expect(host.querySelectorAll('.cfg-row__value [role="switch"]')).toHaveLength(1);
    expect(host.querySelector(".cfg-row__value a")).toBeNull();
  });

  it("renders no note wrapper when there is none", () => {
    mount(false, vi.fn());
    expect(host.querySelector(".cfg-row__note")).toBeNull();
  });

  it("keeps role=switch and aria-checked when disabled", () => {
    mount(true, vi.fn(), true);
    const button = host.querySelector<HTMLElement>('[role="switch"]')!;

    expect(button.getAttribute("role")).toBe("switch");
    expect(button.getAttribute("aria-checked")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("wrap");
  });
});

describe("ConfigRow — changed mark", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    settings.value = DEFAULT_SETTINGS;
  });

  const row = (): Element | null => host.querySelector(".cfg-row");

  it("takes its text from the registry and marks a preference that differs", () => {
    settings.value = { ...DEFAULT_SETTINGS, fontSize: 20 };
    act(() => {
      render(
        <ConfigRow settingKey="fontSize">
          <span />
        </ConfigRow>,
        host,
      );
    });
    expect(host.querySelector(".cfg-row__label")?.textContent).toBe(
      SETTINGS_REGISTRY.fontSize.label,
    );
    expect(row()?.classList.contains("is-changed")).toBe(true);
    expect(row()?.getAttribute("data-setting")).toBe("fontSize");

    act(() => {
      settings.value = DEFAULT_SETTINGS;
    });
    expect(row()?.classList.contains("is-changed")).toBe(false);
  });

  it("marks a whole-key row only for preference-scope keys", () => {
    settings.value = { ...DEFAULT_SETTINGS, sidebarWidth: 300 };
    act(() => {
      render(
        <ConfigRow settingKey="sidebarWidth">
          <span />
        </ConfigRow>,
        host,
      );
    });
    expect(row()?.classList.contains("is-changed")).toBe(false);
  });

  it("an entry row says whether its own entry changed, but a data key never marks", () => {
    act(() => {
      render(
        <>
          <ConfigRow entryOf="agentRuntimeDefaults" label="Default model" changed>
            <span />
          </ConfigRow>
          <ConfigRow entryOf="agentModels" label="Additional models" changed>
            <span />
          </ConfigRow>
        </>,
        host,
      );
    });
    const [model, models] = Array.from(host.querySelectorAll(".cfg-row"));
    expect(model.classList.contains("is-changed")).toBe(true);
    expect(models.classList.contains("is-changed")).toBe(false);
    expect(models.getAttribute("data-setting")).toBe("agentModels");
  });
});
