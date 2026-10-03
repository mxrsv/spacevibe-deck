# Keyboard shortcuts

Every shortcut is an action with a name, and Settings → Shortcuts lets you record a different
key for any of them. The tables below are the shipped defaults, taken from
[`src/terminal/default-keymaps.ts`](../../src/terminal/default-keymaps.ts).

On macOS, bare **⌘C** and **⌘V** are the system Copy and Paste. On Windows, bare **Ctrl+**
chords stay available to the shell and the agent, with two exceptions: **Ctrl+V** pastes, and
**Ctrl+C** copies while the terminal holds a selection and otherwise interrupts the running
program as usual.

## Launch and navigate

| Action                       | macOS       | Windows              |
| ---------------------------- | ----------- | -------------------- |
| Launch an agent | ⌘T        | Ctrl+Shift+T         |
| Jump to the pane that needs you | ⌘⇧A      | Ctrl+Shift+A         |
| Mission Control              | ⌘⇧O        | Ctrl+Shift+O        |
| Next / previous space or chip | ⌘⇧] / ⌘⇧[ | Ctrl+Tab / Ctrl+Shift+Tab |
| Select space or chip 1–8     | ⌘1 … ⌘8    | Ctrl+1 … Ctrl+8      |
| Select the last chip         | ⌘9         | Ctrl+9               |
| Reopen the last closed tab   | ⌘⇧T        | Ctrl+Alt+Shift+T     |

Each terminal tab is a space, shown in the strip as a mark after the current folder's name.
The numbers count the spaces first, then open documents and the browser tab. A sideways
two-finger swipe over the terminals also moves one space.

The **Overview** button on the toolbar opens Mission Control, as ⌘⇧O does. Hover a space at
the top to see its panes, click a pane to go straight to it, or press Esc to go back
unchanged. Nothing stops or restarts while it is open.

## Panes

| Action                        | macOS            | Windows                 |
| ----------------------------- | ---------------- | ----------------------- |
| Split side by side            | ⌘D               | Ctrl+Shift+D            |
| Split stacked                 | ⌘⇧D              | Ctrl+Alt+Shift+D        |
| Close pane                    | ⌘W               | Ctrl+Shift+W            |
| Close tab                     | ⌘⇧W              | Ctrl+Alt+Shift+W        |
| Focus next / previous pane    | ⌘] / ⌘[          | Ctrl+Alt+] / Ctrl+Alt+[ |
| Focus left / right / up / down | ⌘⌥ arrows       | Ctrl+Alt+arrows         |
| Swap with neighbour           | ⌘⌥⇧ arrows       | Ctrl+Alt+Shift+arrows   |
| Expand the focused pane       | ⌘E               | Ctrl+Shift+E            |
| Zoom pane over the tab        | ⌘⇧Enter          | Ctrl+Shift+Enter        |
| Move pane to a new window     | ⌘⇧M              | Ctrl+Shift+M            |

## Terminal

| Action                     | macOS      | Windows                          |
| -------------------------- | ---------- | -------------------------------- |
| Find in scrollback         | ⌘F         | Ctrl+Shift+F                     |
| Find next / previous       | ⌘G / ⌘⇧G   | F3 / Shift+F3                    |
| Clear scrollback (no undo) | ⌘K         | Ctrl+Shift+K                     |
| Copy selection             | ⌘C         | Ctrl+Shift+C, or Ctrl+C with a selection |
| Paste                      | ⌘V         | Ctrl+V, Ctrl+Shift+V, Shift+Insert |
| Copy working directory     | ⌘⇧C        | Ctrl+Alt+Shift+C                 |
| Zoom in / out / reset      | ⌘= / ⌘- / ⌘0 | Ctrl+= / Ctrl+- / Ctrl+0       |
| Scroll a page up / down    | ⇧PageUp / ⇧PageDown | Shift+PageUp / Shift+PageDown |
| Scroll to top / bottom     | ⇧Home / ⇧End | Shift+Home / Shift+End         |

## Surfaces

| Action                     | macOS | Windows      |
| -------------------------- | ----- | ------------ |
| Toggle the side panel      | ⌘⇧J   | Ctrl+Shift+J |
| File explorer              | ⌘⇧B   | Ctrl+Shift+B |
| Token usage                | ⌘⇧U   | Ctrl+Shift+U |
| Session history            | ⌘⇧Y   | Ctrl+Shift+Y |
| Browser tab                | ⌘⇧I   | Ctrl+Shift+I |
| Prompt Board               | ⌘⇧P   | Ctrl+Shift+P |
| Save the open document     | ⌘S    | Ctrl+S       |
| Markdown: rendered ↔ source | ⌘⇧V  | —            |
| Settings                   | ⌘,    | Ctrl+,       |

## Layout presets

| Action                              | macOS | Windows          |
| ----------------------------------- | ----- | ---------------- |
| New layout preset from scratch      | ⌘⇧N   | Ctrl+Alt+Shift+N |
| Save the live layout as a preset    | ⌘⇧S   | Ctrl+Alt+Shift+S |

A preset is a named split layout with optional per-pane directories. A preset can be created
and overwritten, but not renamed or deleted from inside the app.

## Notes

- A shortcut that cannot do anything where you are does not eat the key. For example a pane
  chord pressed over an open document reaches the document instead.
- On macOS, menu-bound chords such as Find and Clear Buffer are consumed by the menu bar
  before a document can see them.
- Bracket and digit chords bind to the physical key position, so they work on non-US layouts.
- On Windows, Ctrl+S saves the open document, but only while a document is on the stage. Over a
  terminal it still goes to the terminal, as it always has.
- ⌘⇧V has no Windows binding because Ctrl+Shift+V is paste. Use the toggle on the document
  surface instead.
