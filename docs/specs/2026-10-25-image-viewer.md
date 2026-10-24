# Image viewer for agent sessions

Date: 2026-10-25
Status: Draft, awaiting the owner's approval. Not ready for implementation: no session or night
run starts work from this spec until this line says it is approved. The intent was confirmed by
the owner on 2026-10-24
in chat: every image that appears in an agent session can be seen in Deck, in one modal, without
opening an IDE. Other places where a terminal limits an agent CLI are researched separately and
are not part of this spec.
Execution: a plan under `docs/plans/` (gitignored, primary checkout only) after approval.

## Purpose

An agent session produces and consumes images that a terminal cannot draw. Today:

- **⌘+click on an image path** the agent printed: inside an open workspace it opens a preview
  tab that refuses the file as binary (`BINARY_REFUSAL` in
  [`file-content.ts`](../../src/files/file-content.ts)); outside every workspace it goes to the
  app on the split button, usually an IDE.
- **A pasted image** shows as `[Image #N]`, and **an image the agent looked at** (a Read of a
  PNG, a browser screenshot) shows nothing at all. Both exist only in the agent's transcript.
- **Explorer** opens an image as the same refused preview; **Changes** shows "Binary file".

Counted on the owner's machine on 2026-10-24, newest 400 transcripts per agent. These are image
records, not distinct images: a record can repeat (see IMG7).

| Image records in the transcripts                    | Claude Code | Codex |
| -------------------------------------------------- | ----------- | ----- |
| Looked at by the agent (inside tool results)        | 2,817       | 116   |
| Pasted by the user                                  | 244         | 36    |

The images the agent looks at outnumber the pasted ones by an order of magnitude, and none of
them has a path on screen to click.

**Image** below means a `.png`, `.jpg`, `.jpeg`, `.webp` or `.svg` file (extension matched
case-insensitively, content confirmed by IMG8), or an image block inside a transcript.

## Requirements

### Where the viewer opens from

- **IMG1**: ⌘+click (Ctrl+click on Windows) on an image path in a pane opens the viewer, inside or
  outside an open workspace, subject to IMG9 and IMG10. Only image paths change route; every
  other path opens exactly as today.
- **IMG2**: ⌘+click on a pasted-image placeholder `[Image #N]` in a Claude Code or Codex pane
  opens the viewer at that image. Both agents print this form; Codex records it as
  `<image name=[Image #N] path=…>` in the rollout. Claude numbers placeholders across the whole
  conversation, Codex restarts per message: when the number is not unique, the newest image
  carrying it opens and ←/→ reach the others. A placeholder in a prompt not yet sent has no
  image in the transcript, and the viewer says so.
- **IMG3**: A registry action (R3) with its own chord opens the viewer at the newest image of the
  focused pane's conversation. The chord shadows no Deck chord, readline key or agent key. No
  image in the conversation → the user is told so, and no empty modal opens.
- **IMG4**: Explorer: activating an image file (click or Enter) opens the viewer instead of a
  preview tab.
- **IMG5**: Changes: activating a changed image whose file exists in the working tree opens the
  viewer on that file. A deleted image keeps today's behaviour.

### A pane's conversation images

- **IMG6**: A pane's conversation is the one Deck already pairs with it for the rail's tail
  (the hook's session id, then the `preferredId` pin through `selectCandidate` in
  [`session-tail.ts`](../../electron/resume/session-tail.ts)). This feature adds no pairing
  heuristic of its own. A pane without a confident pairing shows no conversation images; it
  never shows another session's.
- **IMG7**: Sources, in conversation order:
  - Claude Code: `image` blocks in user messages, and images inside `tool_result` content.
  - Codex: `input_image` items in user messages and in tool-call outputs, from plain and
    compressed rollouts.
  - The bytes come from the transcript, never from the temporary files it references
    (`/private/tmp/claude-*`, `codex-clipboard-*`), which the agents delete.
  - An image recorded twice (Claude's `api-request-blob` copies, a resumed Codex rollout)
    appears once, deduplicated by content.
  - Scanning a long transcript never stalls PTY serving; it yields the way session history
    does, and caps both the bytes scanned and the images listed, keeping the newest.

### Reading and authorization

- **IMG8**: Main reads every image and hands the renderer the result. A file must be a regular
  file opened without following a final symlink, carry an allowed extension and pass a content
  sniff, so non-image bytes named `.png` are refused. The viewer's cap is its own constant of
  32 MiB; the 1 MB logo cap in [`images.ts`](../../electron/images.ts) stays as it is. SVG is
  drawn only as an image, so it runs no script and fetches nothing. The viewer never makes a
  network request.
- **IMG9**: Inside a workspace this window has open, a file is authorized the way markdown
  images are today (the root grants behind `activate_image_workspace_root`). Only the native
  folder picker and a folder drop create a grant today, so some open workspaces have none: a
  clone (added through `addWorkspaceDurably`), and a workspace last picked before grants were
  introduced on 2026-10-10 or evicted past the 256-root cap. Two changes close that gap without
  letting the renderer name a root:
  - a clone grants its destination when it completes, because main created that folder;
  - for any other workspace without a grant, the viewer's state says so in one line and offers
    the native folder picker at that root; picking it creates the grant and the image opens.

  From a pane, a workspace without a grant is otherwise treated as outside (IMG10).
- **IMG10**: Outside every open workspace, main reads a file only when it finds that path in the
  pane's own conversation (IMG6), because the agent printed or used it there. A renderer request
  is never evidence on its own, and neither is a `resolve_paths` hit, because the renderer
  chooses what to resolve. When main cannot establish it (no pairing, a plain shell, an agent
  without a parser), the click goes to the external app as it does today.
- **IMG11**: The renderer asks for a conversation image by pane and position, never by a file
  path.

### The viewer

- **IMG12**: One modal serves every entry point. It covers the stage, so the browser view hides
  under the existing overlay rule.
- **IMG13**: The image fits the stage and is never upscaled. One key or click toggles actual size,
  which scrolls when larger than the stage.
- **IMG14**: Sequence. Opened from a pane (IMG1–IMG3), ←/→ walk that pane's conversation images;
  a file opened by ⌘+click takes the place of an identical conversation image, or else joins the
  end. Without a conversation, and from Explorer or Changes, the viewer holds that one image.
  ←/→ stop at each end; Home and End jump to them.
- **IMG15**: The caption is one line: the file name, or the source for a conversation image
  (pasted, or looked at by the agent), plus the position `3 / 12`. Nothing else is written.
- **IMG16**: States: loading; gone or unreadable; over the cap; not an image. Each says what
  happened in one line. One that has a file path also offers the split button's external app.
- **IMG17**: Escape closes; ←/→, Home and End navigate. Each of them is caught at the document
  and stopped, so none reaches the terminal behind the scrim (DL-29.5). Focus returns to where
  the viewer opened from: the pane, the tree row or the Changes row.
- **IMG18**: The dialog has a role and a name. The image's accessible name comes from its
  caption, and a change of position is announced politely. Under reduced motion nothing
  transitions.
- **IMG19**: At most the shown image and its two neighbours are held decoded; closing the viewer
  releases them all.

## Decisions taken by default

The owner may overturn any of these when approving the spec.

- **Modal shell**: the shipping [`Modal`](../../src/ui/modal.tsx) (DL-29.1), not the Base UI
  [`Dialog`](../../src/ui/controls/dialog.tsx). That control has no shipping consumer yet, and
  its handling of Escape in front of a live terminal (UI-6 of the
  [migration spec](2026-10-21-shadcn-base-ui-migration.md)) is unproven. The viewer moves with
  the overlays wave of that migration.
- **32 MiB cap**: a full-resolution Retina screenshot passes it.
- **Actual size**: included, because a fitted screenshot of a UI is often too small to read.
- **Explorer and Changes** show one image, not their folder or list as a sequence.
- **A deleted image in Changes** keeps today's behaviour; showing its last committed version
  is before/after work.
- **An ambiguous `[Image #N]`** opens the newest match.

## Acceptance

- Parser tests on fixture transcripts for both agents: every source in IMG7, a duplicate record,
  a malformed line skipped, a compressed rollout, the scan cap keeping the newest images.
- Pairing tests: a pane with a confident pairing lists its own images; an ambiguous or missing
  pairing lists none.
- Authorization tests: an out-of-workspace path found in the pane's conversation opens; the same
  path not found there is refused; a final symlink, a non-image file named `.png` and a file over
  the cap are refused; a finished clone's images open; an image in an ungranted root opens only
  after the picker grants that root.
- Placeholder tests: a unique `[Image #N]`, a repeated Codex number, a placeholder with no
  transcript image yet.
- Viewer tests: Escape, ←/→ at both ends, Home and End are stopped before the terminal; focus
  returns to the origin; IMG14's ordering when the clicked file is and is not in the
  conversation.
- The look is chosen from gallery specimens, and the owner approves a screenshot in the running
  app (fitted, actual size, one error state, light and dark) before the UI commit.
- [`getting-started.md`](../user/getting-started.md) (⌘+click, Explorer, Changes) and
  [`keyboard-shortcuts.md`](../user/keyboard-shortcuts.md) describe the viewer and its chord, with
  the `vi` translations updated and stamped. `CHANGELOG.md` has the entry.
- Driving the running app with Playwright happens only when the owner asks for it in that task
  (owner, 2026-10-24); that standing instruction takes the place of AGENTS.md's E2E gate here.

## Risks for the plan

- **Path matching (IMG10)**: a transcript may carry the path relative, behind `~`, or quoted. The
  plan defines the normalization and tests it in both directions.
- **Confident pairing (IMG6)**: two panes running the same agent in one cwd are the known hard
  case; the plan defines "confident" from the existing pairing, not a new rule.
- **Contracts**: new IPC channels keep flat payloads (R6). The authorization in IMG9–IMG11 is a
  file-access boundary; approving this spec approves that boundary, nothing wider.
- **Formats move**: neither transcript format is documented, and opencode's has already changed
  twice. Parsers fail closed per record.
- **Shell rebuild**: the [agent-first shell layout](2026-10-22-agent-first-shell-layout.md) may
  replace Explorer and Changes. IMG4 and IMG5 hook the shared open-file path, so a rebuilt region
  inherits them.

## Out of scope

Other terminal gaps (separate research, 2026-10-24); `http(s)` image URLs, which the browser tab
opens; inline terminal image protocols (sixel, iTerm2, kitty); before/after comparison in
Changes; editing, annotating, copying or exporting images; PDF, GIF and video; opencode, Gemini
and other agents' transcripts, although their in-workspace image paths still open through IMG1;
Tauri.
