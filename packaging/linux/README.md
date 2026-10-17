# Linux build (unsigned, opt-in)

An opt-in path that reproduces an unsigned Linux **AppImage** and **`.deb`** from a
pinned ref. It changes nothing that ships: the macOS and Windows release workflows do
not read any of this, the workflow below runs only from a manual trigger, and it
publishes no release.

## What it does

1. Clones the source at a pinned ref (default `v2.10.0`).
2. Applies `linux-support.patch` — the only source change — at build time.
3. Builds the renderer and the Electron main process.
4. Packages `SpaceVibe-Deck-<version>-linux-x86_64.AppImage` and
   `SpaceVibe-Deck-<version>-linux-amd64.deb`.

## What the patch changes

The source knows only `macos`, `windows` and `unsupported`. The patch adds `linux` so
the app behaves correctly there:

- platform detection reports `linux`, in both the renderer and the Electron main process;
- keyboard shortcuts use the **Ctrl** family instead of macOS `⌘` — the keymap, the keycap
  labels and the native menu accelerators;
- the auto-updater answers "unsupported" on Linux. There is no Linux update feed and
  `electron-updater`'s Linux backend is offered no manifest, so a check could only 404 or
  offer an AppImage user a `.dmg` it cannot install;
- a missing built-in agent offers its `Get` link, not an `Install` command: the shipped
  commands are the vendors' macOS and Windows one-liners, and neither runs on Linux.

Everything else is the source unchanged.

## Building it

```bash
scripts/build-linux.sh          # builds the ref pinned in the script, v2.10.0
scripts/build-linux.sh v2.9.0   # or any ref the patch still applies to
```

Artifacts land in `dist-electron-linux/`. The build needs Node.js 20+ and the native
build tools Electron and `node-pty` expect on Linux. It calls the renderer's two real
build steps directly, so it does not need the Rust toolchain the `prebuild` hook requires.

The `.github/workflows/linux-artifact.yml` workflow runs the same script by hand
(`workflow_dispatch`) and uploads the AppImage and `.deb` as a workflow artifact.

## Limits

- **Unsigned.** No Linux signing is configured and the `.deb` is in no repository.
- **x86_64 only.**
- **No update feed.** A build made here never updates itself and never moves a release
  channel; a new build means a new download.
- **Not a release.** This is a starting point for a Linux distribution decision, not one.
