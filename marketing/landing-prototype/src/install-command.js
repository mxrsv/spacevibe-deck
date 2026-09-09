export const INSTALL_PLATFORMS = {
  mac: {
    command: "curl -fsSL https://deck.spacevibe.dev/install.sh | sh",
    label: "macOS",
    prefix: "$",
    status: "Apple Silicon",
  },
  win: {
    command: "irm https://deck.spacevibe.dev/install.ps1 | iex",
    label: "Windows",
    prefix: "PS›",
    status: "x64 · unsigned installer",
  },
};

const COPY_RESET_MS = 1800;
const PLATFORM_KEYS = Object.keys(INSTALL_PLATFORMS);

export function initialInstallPlatform(navigatorLike = globalThis.navigator) {
  const platform = [
    navigatorLike?.userAgentData?.platform,
    navigatorLike?.platform,
    navigatorLike?.userAgent,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return platform.includes("win") ? "win" : "mac";
}

function renderPlatformControl(key) {
  const platform = INSTALL_PLATFORMS[key];

  return `
    <button
      class="quick-install__platform"
      type="button"
      role="tab"
      id="quick-install-${key}-tab"
      aria-controls="quick-install-command"
      aria-selected="false"
      data-install-platform="${key}"
      tabindex="-1"
    >
      <span>${platform.label}</span>
    </button>
  `;
}

export function renderQuickInstall() {
  return `
    <section
      class="quick-install"
      data-quick-install
      data-install-state="idle"
      aria-labelledby="quick-install-title"
    >
      <h2 class="quick-install__title" id="quick-install-title">Quick install</h2>

      <div class="quick-install__selector" role="tablist" aria-label="Install platform">
        <span class="quick-install__recommended">Recommended</span>
        ${PLATFORM_KEYS.map(renderPlatformControl).join("")}
      </div>

      <div class="quick-install__status">
        <span data-install-status></span>
      </div>

      <div
        class="quick-install__command"
        id="quick-install-command"
        role="tabpanel"
        aria-live="off"
      >
        <span class="quick-install__prefix" data-install-prefix aria-hidden="true"></span>
        <code data-install-command></code>
        <button
          class="quick-install__copy"
          type="button"
          aria-label="Copy install command"
          data-install-copy
        >
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
            <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
            <path d="M13.5 6.5V5A1.5 1.5 0 0 0 12 3.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5" />
          </svg>
          <span data-install-copy-label>Copy</span>
        </button>
      </div>

      <!-- No manual-download link here since 2026-09-10: the hero's two
           install buttons carry that job, and a third path to the same
           installer read as clutter. -->
      <div class="quick-install__footer">
        <span class="quick-install__feedback" role="status" aria-live="polite" data-install-feedback></span>
      </div>
    </section>
  `;
}

export function mountQuickInstall(
  root,
  { navigatorLike = globalThis.navigator, clipboard = navigatorLike?.clipboard } = {},
) {
  const shell = root.matches?.("[data-quick-install]")
    ? root
    : root.querySelector("[data-quick-install]");

  if (!shell) {
    throw new Error("Quick install root is missing.");
  }

  const controls = [...shell.querySelectorAll("[data-install-platform]")];
  const command = shell.querySelector("[data-install-command]");
  const prefix = shell.querySelector("[data-install-prefix]");
  const status = shell.querySelector("[data-install-status]");
  const copyButton = shell.querySelector("[data-install-copy]");
  const copyLabel = shell.querySelector("[data-install-copy-label]");
  const feedback = shell.querySelector("[data-install-feedback]");

  if (!command || !prefix || !status || !copyButton || !copyLabel || !feedback) {
    throw new Error("Quick install controls are incomplete.");
  }

  let selected = initialInstallPlatform(navigatorLike);
  let resetTimer = null;
  const clickHandlers = new Map();

  function renderPlatform(nextPlatform, { focus = false } = {}) {
    const platform = INSTALL_PLATFORMS[nextPlatform];

    if (!platform) {
      return;
    }

    selected = nextPlatform;
    shell.dataset.platform = selected;
    shell.dataset.installState = "idle";
    command.textContent = platform.command;
    prefix.textContent = platform.prefix;
    status.textContent = platform.status;
    copyLabel.textContent = "Copy";
    feedback.textContent = "";

    for (const control of controls) {
      const active = control.dataset.installPlatform === selected;
      control.setAttribute("aria-selected", String(active));
      control.tabIndex = active ? 0 : -1;

      if (active) {
        shell.querySelector("[role=tabpanel]")?.setAttribute("aria-labelledby", control.id);

        if (focus) {
          control.focus();
        }
      }
    }
  }

  function moveSelection(event) {
    const index = controls.indexOf(event.currentTarget);
    let nextIndex = index;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % controls.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + controls.length) % controls.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = controls.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    renderPlatform(controls[nextIndex].dataset.installPlatform, { focus: true });
  }

  async function copyCommand() {
    clearTimeout(resetTimer);

    try {
      if (typeof clipboard?.writeText !== "function") {
        throw new Error("Clipboard API unavailable.");
      }

      await clipboard.writeText(INSTALL_PLATFORMS[selected].command);
      shell.dataset.installState = "copied";
      copyLabel.textContent = "Copied";
      feedback.textContent = "Command copied.";
    } catch {
      shell.dataset.installState = "copy-failed";
      copyLabel.textContent = "Copy failed";
      feedback.textContent = "Automatic copy failed. Select the command and copy it manually.";
    }

    resetTimer = setTimeout(() => {
      shell.dataset.installState = "idle";
      copyLabel.textContent = "Copy";
      feedback.textContent = "";
    }, COPY_RESET_MS);
  }

  for (const control of controls) {
    const selectPlatform = () => {
      renderPlatform(control.dataset.installPlatform);
    };

    clickHandlers.set(control, selectPlatform);
    control.addEventListener("click", selectPlatform);
    control.addEventListener("keydown", moveSelection);
  }

  copyButton.addEventListener("click", copyCommand);
  renderPlatform(selected);

  return () => {
    clearTimeout(resetTimer);
    copyButton.removeEventListener("click", copyCommand);

    for (const control of controls) {
      control.removeEventListener("click", clickHandlers.get(control));
      control.removeEventListener("keydown", moveSelection);
    }
  };
}
