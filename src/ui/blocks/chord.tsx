import { Kbd, KbdGroup } from "../controls/kbd";

/** A keyboard chord, one key cap per key: `["⌘", ","]` reads ⌘ ,. */
export function Chord({
  keys,
  label,
}: {
  readonly keys: readonly string[];
  readonly label?: string;
}) {
  return (
    <KbdGroup aria-label={label}>
      {keys.map((key, at) => (
        <Kbd key={`${at}:${key}`}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}
