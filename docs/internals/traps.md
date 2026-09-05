# Known traps and live switches

Things that have bitten this codebase and are not obvious from reading one file, plus the
constants that currently switch behaviour off and are meant to be flipped back.

## Layout and CSS

- **`#root` is `overflow: clip`, not `hidden`.** `hidden` still builds a scroll container, so
  the first `scrollIntoView` the browser runs on focus shifted the traffic lights, the strip
  and every fixed thing up with nothing to scroll them back. Treat "the top bar looks
  misaligned" as a scroll report.
- **There is no global `box-sizing` reset.** `width: 100%` beside a padding overflows its box.
  Form controls get `border-box` from the user agent; a plain element does not, which is how
  `.session-row` grew a horizontal scrollbar the moment it stopped being a `<button>`.
  Declare it on any element you give a percentage size and a padding.
- **A 1px overflow in the rail moves the whole column.** `.asr-rail__list` clips
  horizontally without removing the scroll container, so a border bled by `margin: 0 -1px`
  slid the column on the first focus. The multi-agent frame is an inset `box-shadow` for
  this reason: it paints inside, needs no layout and clips nothing.
- **`.iconbtn` never resets the user agent's button padding**, so every icon in one sits
  1.5px left of centre: the grid track is 12px against a 15px glyph, and Chromium clamps
  the negative offset. The rendered view's toggle carries its own `padding: 0`; the app-wide
  fix has not been made.
- **A custom scrollbar does not repaint when only the scroller's `:hover` flips.** The
  app-wide thumb is transparent at rest and lit through `*:hover::-webkit-scrollbar-thumb`,
  and that rule never reaches the screen: Chromium repaints a custom scrollbar on its own
  state change or an inherited property change, not on the originating element's hover.
  Every scroll surface is effectively thumbless until the pointer lands on the 6px strip;
  only `.md-doc` declares a resting colour.
- **A shorthand holding `var()` restarts its animation on any global style recalc.** Put
  `var()`-carrying animation values on the longhands.
- **`src/styles.css` is an import index whose order is the cascade.** Several rules rely on
  position, not specificity. Add rules inside the partial, never in the index, and note
  that the design-language test concatenates the partials in that order.
- **Props on the element `DesktopChrome` returns are applied on mount and never updated.**
  The sidebar's live width and collapsed flag are written to `:root` imperatively to
  sidestep it.

## Hosts and evidence

- **The app running an update is the old build.** An updater fix cannot protect the
  transition into the release that carries it.
- **Two hosts means two answers.** A renderer change that passes under Electron says nothing
  about Tauri. Name the host a change runs on rather than implying both.
- **Green unit and build checks are not native evidence.** They say nothing about PTYs, menu
  accelerators, window close, the updater or packaging on real hardware, and nothing about
  Windows, where no owner has run a real-hardware pass.
- **Browser `npm run dev` paints the shell because IPC failures are caught.** It cannot prove
  persistence, PTY, updater or packaging behaviour.
- **Only the macOS menu is native.** Electron installs no menu on other platforms, so every
  chord there is a renderer binding; a macOS menu-bound chord (Find, Clear Buffer, zoom) is
  consumed by Cocoa before a document can see it.
- **`windows-check` in CI has pre-existing failures** unrelated to the Electron host, which is
  why the Windows packaging job is deliberately not gated on it.

## Data and contracts

- **A store that cannot be read is write-locked.** Do not "fix" an unreadable file by
  writing defaults over it; the lock exists so recoverable bytes survive.
- **`CHANGELOG.md` is machine-read** by the release workflow. Its `## <version>` headings and
  its location are part of the release contract.
- **`docs/DESIGN-LANGUAGE.md` is read by a test at runtime.** Moving, renaming or trimming
  a cited rule breaks `npm test`.
- **IPC payloads are typed separately on each side.** A key the handler destructures and the
  renderer never sends is green everywhere but the running app; the contract test is the
  only early signal. Keep flat keys where the contract is flat.
- **`open_pane_window`, `prepare_transfer` and `offer_transfer` have frozen shapes:** flat
  arguments, a string `paneId`, and `targetLabel`. Two of the three shipped broken once.
- **`node-pty` delivers strings on Windows** whatever encoding you ask for, and it ignores
  `encoding: null`; the streaming decoder passes strings through. Handing one to
  `TextDecoder.decode` throws inside node-pty's emitter and kills the main process.
- **The spawn helpers lose their executable bit** on install; the postinstall restores it and
  the only symptom otherwise is `posix_spawnp failed`.
- **`marketing/**` has no lint gate.** It is in `.prettierignore` and oxlint's ignore list, so
  a "prettier clean" claim over that tree is vacuous. It also shares application components
  and a virtual clock, so a component change can silently alter rendered media.
- **`npm run refresh:pricing` reaches the network** and must never run from a build.
- The Rust and Electron usage scanners are held equal by a golden fixture that must be
  regenerated from the Rust side, never from the port's own output.

## Live switches

Each is one typed constant whose other branch is kept in the tree on purpose, so reverting
is flipping it back. They are typed `boolean` rather than left as literals so a dead-code
pass cannot delete the half they exist to keep.

| Constant                   | Where                                                             | Currently | Effect                                                                                  |
| -------------------------- | ----------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `GRAB_PASTE_DISABLED`      | [`src/browser/browser-store.ts`](../../src/browser/browser-store.ts) | `true`  | A browser grab stops at the clipboard and is never pasted into a pane                   |
| `MIGRATION_NOTICE_ENABLED` | [`src/updater/migration-notice.ts`](../../src/updater/migration-notice.ts) | `true` | Tauri builds show the "this build no longer updates itself" row                       |
| `USAGE_CONSENT_ASKED`      | [`src/telemetry/usage-notice.ts`](../../src/telemetry/usage-notice.ts) | `false` | No consent question is asked; analytics is on by default and the modal mounts nowhere |
| `PANE_TREE_HIDDEN`         | [`src/ui/agent-rail.tsx`](../../src/ui/agent-rail.tsx)             | `true`    | A multi-agent tab renders flat framed rows instead of a parent row with elbow guides    |

Two more retirements follow the same pattern without a constant: the theme gallery, colour
overrides and theme import are unmounted from Settings but still build and still resolve a
stored id; and `RepositoryRail` is mounted only in the gallery.
