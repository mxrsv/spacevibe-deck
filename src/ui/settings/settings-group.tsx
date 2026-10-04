import type { ComponentChildren } from "preact";

/** DL-11.6: Studio groups share the existing settings controls. */
export function SettingsGroup({
  title,
  description,
  children,
}: {
  readonly title?: string;
  readonly description?: string;
  readonly children: ComponentChildren;
}) {
  return (
    <section class="settings-group">
      {title && (
        <header class="settings-group__head">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </header>
      )}
      <div class="settings-group__body">{children}</div>
    </section>
  );
}
