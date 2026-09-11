import { CaretDown } from "@phosphor-icons/react";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";

interface AgentChoice {
  readonly value: string;
  readonly label: string;
}

export const CLI_DEFAULT_CHOICE: AgentChoice = { value: "", label: "CLI default" };

/** DL-6.5: the CLI default counts toward the two/three-choice binary limit.
 * More choices use the native overlay menu from DL-6. Stored model IDs that
 * are no longer in the catalog remain visible until the user replaces them. */
export function AgentChoiceValue({
  label,
  value,
  choices,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly choices: readonly AgentChoice[];
  readonly onChange: (value: string) => void;
}) {
  const options = choices.some((choice) => choice.value === value)
    ? choices
    : [...choices, { value, label: value }];
  if (options.length > 3) {
    return (
      <span class="cfg-btn cfg-btn--overlay">
        <span class="cfg-btn__text">{options.find((choice) => choice.value === value)?.label}</span>
        <span class="cfg-btn__hint">
          <DeckIcon icon={CaretDown} size={ROW_ICON} />
        </span>
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {options.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </span>
    );
  }
  const move = (event: KeyboardEvent): void => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    const index = options.findIndex((choice) => choice.value === value);
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (index + (forward ? 1 : -1) + options.length) % options.length;
    (event.currentTarget as HTMLElement)
      .querySelectorAll<HTMLButtonElement>("button")
      [next]?.focus();
    onChange(options[next].value);
  };
  return (
    <div class="segmented" role="radiogroup" aria-label={label} onKeyDown={move}>
      {options.map((choice) => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={choice.value === value}
          tabIndex={choice.value === value ? 0 : -1}
          class={`segmented__option ${choice.value === value ? "is-selected" : ""}`}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
