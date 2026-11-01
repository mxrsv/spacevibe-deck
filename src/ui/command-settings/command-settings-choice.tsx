import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../controls/select";

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

/** "The CLI's own default" has no value of its own; the menu needs one that no model id can be. */
const DEFAULT_VALUE = "\u0000cli-default";

export const CLI_DEFAULT: ChoiceOption = { value: "", label: "CLI default" };

/**
 * A menu over a few options where "" means the CLI's own default. A stored value the catalog no
 * longer lists stays visible until the user replaces it, as the legacy control did.
 */
export function ChoiceSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly ChoiceOption[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  const listed = options.some((option) => option.value === value)
    ? options
    : [...options, { value, label: value }];
  const items = listed.map((option) => ({
    value: option.value === "" ? DEFAULT_VALUE : option.value,
    label: option.label,
  }));
  return (
    <Select
      items={items}
      value={value === "" ? DEFAULT_VALUE : value}
      disabled={disabled}
      onValueChange={(next: unknown) => onChange(next === DEFAULT_VALUE ? "" : String(next))}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
