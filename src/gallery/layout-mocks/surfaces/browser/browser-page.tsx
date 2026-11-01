import { useSignal } from "@preact/signals";
import { cn } from "@/lib/cn";
import { MODEL_ROWS, PROVIDERS, type PickedElement, type Provider } from "./browser-data";

/** Page-injected pick highlight: it lives inside the native view's own rectangle. */
const HOT = "outline outline-2 -outline-offset-2 outline-[#2563eb] bg-[#2563eb]/10";

function Tag({ children }: { readonly children: string }) {
  return (
    <span className="absolute -top-4 left-0 z-10 whitespace-nowrap bg-[#2563eb] px-1.5 font-mono text-[10px] leading-4 text-white">
      {children}
    </span>
  );
}

/**
 * The page the native view shows: a local dev app (the bench leaderboard with the provider
 * filter). It always paints light, like a real page, and knows nothing of the shell's theme.
 */
export function MockLeaderboard({
  width,
  picking,
  picked,
  onPick,
  port,
}: {
  /** The page's own CSS width, which decides which columns it keeps. */
  readonly width: number;
  readonly picking: boolean;
  readonly picked: PickedElement | null;
  readonly onPick: (element: PickedElement) => void;
  readonly port: number;
}) {
  const filter = useSignal<Provider>("All");
  const hot = useSignal<string | null>(picking ? "row-gem-pro" : null);
  const rows = MODEL_ROWS.filter((row) => filter.value === "All" || row.provider === filter.value);
  const showCost = width >= 520;
  const showProvider = width >= 420;
  const wide = width >= 520;

  const pickable = (id: string, selector: string, summary: string) => ({
    "data-pick": id,
    onMouseEnter: picking ? () => (hot.value = id) : undefined,
    onMouseLeave: picking ? () => (hot.value = null) : undefined,
    onClickCapture: picking
      ? (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          onPick({ selector, summary });
        }
      : undefined,
  });
  const lit = (id: string) => picking && hot.value === id;
  const chosen = (selector: string) => picked?.selector === selector;
  const isPicked = (selector: string) => chosen(selector) && !picking;

  return (
    <div
      className={cn(
        "h-full overflow-hidden bg-white font-sans text-[13px] text-neutral-900",
        picking && "cursor-crosshair",
      )}
    >
      <header className="flex h-11 items-center gap-5 border-b border-neutral-200 px-5">
        <span className="text-sm font-semibold tracking-tight">Bench</span>
        <nav className="flex gap-4 text-neutral-600">
          <span className="font-medium text-neutral-900">Leaderboard</span>
          <span>Compare</span>
        </nav>
        <span className="ml-auto font-mono text-[11px] text-neutral-500">:{port}</span>
      </header>
      <main className={cn("flex flex-col gap-4", wide ? "p-5" : "p-4")}>
        <h1 className="m-0 text-xl font-semibold tracking-tight">Leaderboard</h1>
        <div role="group" aria-label="Provider" className="flex flex-wrap gap-1.5">
          {PROVIDERS.map((provider) => {
            const selector = `button.provider-chip[data-provider=${provider.toLowerCase()}]`;
            const on = filter.value === provider;
            return (
              <button
                key={provider}
                type="button"
                {...pickable(`chip-${provider}`, selector, `${provider} filter chip`)}
                onClick={() => {
                  if (!picking) filter.value = provider;
                }}
                className={cn(
                  "relative h-7 rounded-full border px-3 text-xs font-medium",
                  on
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 bg-white text-neutral-700",
                  lit(`chip-${provider}`) && HOT,
                  isPicked(selector) && HOT,
                )}
              >
                {lit(`chip-${provider}`) ? <Tag>{`chip ${provider}`}</Tag> : null}
                {provider}
              </button>
            );
          })}
        </div>
        <table className="-mx-2 w-[calc(100%+1rem)] border-collapse text-left [&_td]:px-2 [&_th]:px-2">
          <thead>
            <tr className="border-b border-neutral-200 text-[11px] text-neutral-600">
              <th className="w-10 py-2 font-medium">#</th>
              <th className="py-2 font-medium">Model</th>
              {showProvider ? <th className="py-2 font-medium">Provider</th> : null}
              <th className="py-2 text-right font-medium">Score</th>
              {showCost ? <th className="py-2 text-right font-medium">$ / 1M</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const id = `row-${row.id}`;
              const selector = `tr.model-row[data-model="${row.id}"]`;
              return (
                <tr
                  key={row.id}
                  {...pickable(id, selector, `${row.model} row, score ${row.score}`)}
                  className={cn(
                    "relative h-9 border-b border-neutral-100",
                    lit(id) && HOT,
                    isPicked(selector) && HOT,
                  )}
                >
                  <td className="relative tabular-nums text-neutral-600">
                    {lit(id) ? <Tag>{`tr.model-row ${width}x36`}</Tag> : null}
                    {index + 1}
                  </td>
                  <td className="font-medium">{row.model}</td>
                  {showProvider ? <td className="text-neutral-600">{row.provider}</td> : null}
                  <td className="text-right font-semibold tabular-nums">{row.score}</td>
                  {showCost ? (
                    <td className="text-right tabular-nums text-neutral-600">{row.cost}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>
    </div>
  );
}
