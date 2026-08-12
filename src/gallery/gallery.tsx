import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { GALLERY_SECTIONS } from "./section-registry";
import { unhandledCommands } from "./host-stub";

const DEFAULT_SECTION_ID = "chrome";

/**
 * The gallery shell.
 *
 * The gallery carries one selected direction. Its specimens remain live app
 * components, while the gallery root supplies the fixed semantic token set so
 * legacy theme values cannot leak between sections.
 */

export function Gallery() {
  const activeId = useSignal(DEFAULT_SECTION_ID);
  const contentRef = useRef<HTMLElement>(null);

  const active =
    GALLERY_SECTIONS.find((section) => section.id === activeId.value) ??
    GALLERY_SECTIONS[0];

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [active.id]);

  const Section = active.Section;
  const missing = unhandledCommands.value;

  return (
    <div class="gx-app gx-app--chatgpt">
      <header class="gx-topbar">
        <span class="gx-topbar__title">Deck</span>
        <span class="gx-direction-badge">ChatGPT Desktop</span>
        <span class="gx-topbar__hint">
          selected direction · real components · gallery-only treatment
        </span>
      </header>

      <nav class="gx-rail" aria-label="Gallery sections">
        {GALLERY_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            class={`gx-rail__item ${section.id === active.id ? "is-active" : ""}`}
            aria-current={section.id === active.id}
            onClick={() => {
              activeId.value = section.id;
            }}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <main ref={contentRef} class="gx-content">
        <div key={active.id} class="gx-section">
          <Section />
        </div>
      </main>

      <footer class="gx-foot">
        {missing.length === 0 ? (
          <span>
            every IPC call the specimens made was answered by the stub.
          </span>
        ) : (
          <span>
            unstubbed IPC ({missing.length}): <code>{missing.join(", ")}</code>{" "}
            — the surfaces that need these render without their data.
          </span>
        )}
      </footer>
    </div>
  );
}
