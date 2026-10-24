# Image viewer for agent sessions

Date: 2026-10-25
Status: Review recommendations accepted by the owner on 2026-10-25; revised specification and
implementation plan prepared. Implementation has not started. This task records the corrections
and staged approach; it does not start an implementation or unattended run.
The intent was confirmed on 2026-10-24: images in an agent session can be seen in Deck, in one
modal, without opening an IDE, subject to the authorization, format and resource limits below.
Other terminal limitations are outside this spec.
Execution: `docs/plans/2026-10-25-image-viewer.md`, local and gitignored in the primary checkout.
The plan is not available in a fresh clone; this spec owns the requirements.

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

| Image records in the transcripts             | Claude Code | Codex |
| -------------------------------------------- | ----------- | ----- |
| Looked at by the agent (inside tool results) | 2,817       | 116   |
| Pasted by the user                           | 244         | 36    |

The images the agent looks at outnumber the pasted ones by an order of magnitude, and none of
them has a path on screen to click.

**Image** below means a `.png`, `.jpg`, `.jpeg`, `.webp` or `.svg` file (extension matched
case-insensitively, content confirmed by IMG8), or an image block inside a transcript.

## Requirements

### Where the viewer opens from

- **IMG1**: ⌘+click (Ctrl+click on Windows) on an image path in a pane opens the viewer, inside or
  outside an open workspace, subject to IMG9 and IMG10. Only image paths change route; every
  other path opens exactly as today. The request retains the originating pane and the original
  path spelling before resolution; a later focus change never changes the source conversation.
- **IMG2**: ⌘+click on a pasted-image placeholder `[Image #N]` in a Claude Code or Codex pane
  opens the viewer at that image. Both agents print this form; Codex records it as
  `<image name=[Image #N] path=…>` in the rollout. Claude numbers placeholders across the whole
  conversation, Codex restarts per message: when the number is not unique, the newest image
  carrying it in the retained snapshot opens and ←/→ reach the others. All placeholder aliases
  survive content deduplication. A lookup searches recorded messages only: without a recorded
  match it says "No recorded image for this placeholder." If the scan was incomplete it says
  that the match could not be established within the read limit instead.
  V1 cannot distinguish an unsent placeholder from an earlier recorded placeholder with the
  same number; clicking it can open that earlier image. It does not claim to detect submission
  state or add a heuristic for the CLI's live prompt region. Aliases must come from explicit
  recorded labels or proven conversation numbering context. A bounded suffix without the
  earlier numbering context cannot renumber its first image as `#1`; report that the mapping
  cannot be established within the read limit instead.
- **IMG3**: A registry action (R3) with its own chord opens the viewer at the newest image of the
  focused pane's conversation. The chord shadows no Deck chord, readline key or agent key. No
  image in a completed scan → the user is told so, and no empty modal opens. Missing verified
  identity, an unreadable transcript, and an incomplete scan are distinct from no images.
- **IMG4**: Explorer: activating an image file (click or Enter) opens the viewer instead of a
  preview tab.
- **IMG5**: Changes: activating a changed image whose file exists in the working tree opens the
  viewer on that file. A deleted image keeps today's behaviour.

### A pane's conversation images

- **IMG6**: Main must verify the current pane-to-session identity using existing authoritative
  sources: an accepted hook bound to the current foreground generation, a fresh Claude registry
  entry joined to that foreground process, or an unambiguous Codex process/thread-lock identity.
  Sender ownership and the current foreground generation are checked for each request.
  Cwd/mtime ranking in [`selectCandidate`](../../electron/resume/resolve.ts), a remembered
  `preferredId`, or an identity asserted by the renderer is not authorization evidence.
  There is no new pairing heuristic. Missing, stale, conflicting or ambiguous evidence yields
  no conversation images and no IMG10 file access. A process replacement, session switch, pane
  close or ownership transfer invalidates its snapshots. An unavailable identity source on a
  platform, including Windows, degrades explicitly; workspace file viewing remains independent.
- **IMG7**: Sources, in conversation order:
  - Claude Code: `image` blocks in user messages, and images inside `tool_result` content.
  - Codex: `input_image` items in user messages and in tool-call outputs, from plain and
    compressed rollouts.
  - The bytes come from the transcript, never from the temporary files it references
    (`/private/tmp/claude-*`, `codex-clipboard-*`), which the agents delete.
  - An image recorded twice (Claude's `api-request-blob` copies, a resumed Codex rollout)
    appears once, deduplicated by encoded image bytes. Keep the newest occurrence's ordering
    and source label, and retain every recorded placeholder alias for that content.
  - Read asynchronously with cancellation and bounded records; decompression, JSON parsing and
    content hashing must not monopolize the main event loop. Yielding only between files is
    insufficient for one large transcript. Do not reuse synchronous whole-frame tail decoding.
  - Plain JSONL can be scanned from its end; an incomplete boundary record is excluded. A zstd
    frame is streamed from its beginning and cannot promise its newest images unless EOF was
    reached. The budgets below bound both paths. Oversized records are explicitly skipped;
    individual malformed records do not abort other records.
  - A bounded scan reports its coverage: complete, a newest suffix with older records omitted,
    or incomplete (for example a compressed prefix stopped before EOF). Only the first two
    may identify their last retained image as the newest within that coverage. Never present
    a compressed prefix as the conversation's newest images, or a limited/failed scan as empty.
    Available images may still be viewed with a one-line limit state. Partial trailing writes
    are not consumed as complete records; reopening retries against the then-current source.

### Reading and authorization

- **IMG8**: Main reads every image and hands the renderer the result. A file must be a regular
  file opened without following a final symlink, carry an allowed extension and pass a content
  sniff, so non-image bytes named `.png` are refused. The viewer's cap is its own constant of
  32 MiB; the 1 MB logo cap in [`images.ts`](../../electron/images.ts) stays as it is. Dimension
  and decoded-memory budgets below also apply before allocating a full decoded image, including
  transcript images. A valid header is not proof that the entire image can be decoded: decode
  failures have an explicit unreadable/not-an-image state.
  Preserve the unresolved final component for the no-symlink check; canonicalization alone
  cannot prove it. Enforce the same boundary for workspace and conversation-authorized paths,
  including Windows reparse points. If a platform cannot safely open such a file, refuse the
  internal read and offer the external app; do not silently weaken the boundary.
  SVG is drawn only as an image with a bounded rasterization size, so it runs no script and
  fetches nothing. Unknown or excessive dimensions are refused. The viewer never makes a
  network request; transcript URL/path references without embedded bytes are not fetched.
- **IMG9**: Inside a workspace this window has open, a file is authorized the way markdown
  images are today (the root grants behind `activate_image_workspace_root`). Only the native
  folder picker and a folder drop create a grant today, so some open workspaces have none: a
  clone (added through `addWorkspaceDurably`), and a workspace last picked before grants were
  introduced on 2026-10-10 or evicted past the 256-root cap. Two changes close that gap without
  letting the renderer name a root:
  - a clone grants its destination when it completes, because main created that folder;
  - for any other workspace without a grant, the viewer's state says so in one line and offers
    the native folder picker starting at that root; picking the matching canonical root creates
    the grant and retries the image. Cancellation, a different selection or a failed grant save
    does not authorize the original image and remains retryable.

  From a pane, a workspace without a grant is otherwise treated as outside (IMG10).

- **IMG10**: Outside every open workspace, main reads a file only when it finds that path in the
  pane's own conversation (IMG6), because the agent printed or used it there. A renderer request
  is never evidence on its own, and neither is a `resolve_paths` hit, because the renderer
  chooses what to resolve. When main cannot establish it (no pairing, a plain shell, an agent
  without a parser, or the relevant record was not scanned), the click goes to the external app
  as it does today. Match complete path occurrences/structured path fields, not substrings.
  Resolve relative paths using the recorded context of that occurrence, not today's pane cwd;
  missing or ambiguous context cannot grant access. A mentioned path grants no parent directory.
- **IMG11**: For conversation images, main creates a snapshot bound to the requesting window,
  pane, verified session and foreground generation. The renderer requests image bytes using the
  opaque snapshot id and position, never a transcript file path or session id as authority.
  The ordered positions and placeholder aliases stay fixed for the snapshot's lifetime, even
  if new records arrive.
  Reopening creates a new snapshot. Invalidated snapshots and stale replies never resolve a
  position against a different session or replacement list. Source replacement/compaction that
  prevents reading the same recorded bytes expires the snapshot and asks the user to reopen.
  Workspace-only file snapshots require the owning window and file grant, not a live agent.
  Each window owns at most one active viewer snapshot and one pending open request; a new open
  cancels the previous pending request and replaces/releases its previous snapshot.

### The viewer

- **IMG12**: One modal serves every entry point. It covers the stage, so the browser view hides
  under the existing overlay rule. Its open state must join the native-browser visibility and
  action-overlay guards; mounting a `Modal` alone does not register those guards.
- **IMG13**: The image fits the stage and is never upscaled. One key or click toggles actual size,
  which scrolls when larger than the stage.
- **IMG14**: Sequence. Opened from a pane (IMG1–IMG3), ←/→ walk that pane's conversation images;
  a file opened by ⌘+click takes the place of an identical conversation image, or else joins the
  end. Without a conversation, and from Explorer or Changes, the viewer holds that one image.
  ←/→ stop at each end; Home and End jump to them.
- **IMG15**: The caption is one line: the file name, or the source for a conversation image
  (pasted, or looked at by the agent), plus the position `3 / 12`. Counts describe the retained
  snapshot, not an unscanned conversation. Only an IMG16 state may add another line.
- **IMG16**: States: loading; gone or unreadable; over the cap; not an image. Each says what
  happened in one line. Also distinguish missing verified identity, a missing root grant, a
  limited scan/oversized record, and an expired snapshot. Available images remain navigable
  during a scan-limit state. One that has a file path also offers the split button's external
  app; no state represents partial results as a complete empty conversation.
- **IMG17**: Escape closes; ←/→, Home and End navigate. Each of them is caught at the document
  and stopped, so none reaches the terminal behind the scrim (DL-29.5). Focus returns to where
  the viewer opened from: the pane, the tree row or the Changes row.
- **IMG18**: The dialog has a role and a name. The image's accessible name comes from its
  caption, and a change of position is announced politely. Under reduced motion nothing
  transitions.
- **IMG19**: At most the shown image and its two neighbours are held decoded; closing the viewer
  cancels work and releases all owned references, buffers and object URLs in main and renderer.
  Neighbour preloading is optional and stops at the total decoded budget. Rapid navigation or
  close/reopen discards late scan/read/decode results; they cannot restore a closed snapshot.
  This bounds app-owned work, not the exact instant Chromium returns memory to the OS.

### Resource defaults

These are initial implementation budgets, not measured performance claims. Lower caps must
produce the same explicit limit states rather than dropping images silently.

| Resource                                    | V1 budget                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| Encoded bytes per image, file or transcript | 32 MiB                                                                    |
| Raster dimensions / pixels per image        | 16,384 per axis; 32,000,000 pixels total                                  |
| Total retained decoded surfaces per viewer  | 256 MiB estimated as width × height × 4; at most three images             |
| Retained encoded image bytes per viewer     | 64 MiB; load on demand and evict neighbours first                         |
| Images listed per snapshot                  | 200 newest distinct images in the scanned coverage                        |
| One JSONL record                            | 96 MiB, including base64 and JSON; larger records are reported as skipped |
| Plain JSONL scan input                      | 256 MiB from the end, including boundary handling                         |
| Compressed scan input / decompressed output | 64 MiB / 256 MiB; stop and report incomplete when either is exhausted     |

The record cap deliberately differs from usage's 8 MiB cap. Several images in one message may
exceed it even when each image is under 32 MiB; that is a disclosed skipped record, not a claim
that no images exist. Do not transfer or retain every image's base64 in a metadata list.
SVG render surfaces share the dimension/pixel budget; internal codec/filter allocations are
not covered by the RGBA estimate and remain a runtime validation concern.

## Decisions taken by default

Defaults for the accepted staged direction; changes to the product boundary return to this spec.

- **Modal shell**: the shipping [`Modal`](../../src/ui/modal.tsx) (DL-29.1), not the Base UI
  [`Dialog`](../../src/ui/controls/dialog.tsx). That control has no shipping consumer yet, and
  its handling of Escape in front of a live terminal (UI-6 of the
  [migration spec](2026-10-21-shadcn-base-ui-migration.md)) is unproven. The viewer moves with
  the overlays wave of that migration.
- **32 MiB cap plus pixel limits**: encoded file size alone cannot bound decode memory.
- **Actual size**: included, because a fitted screenshot of a UI is often too small to read.
- **Explorer and Changes** show one image, not their folder or list as a sequence.
- **A deleted image in Changes** keeps today's behaviour; showing its last committed version
  is before/after work.
- **An ambiguous `[Image #N]`** opens the newest recorded match in the retained snapshot;
  submission-state detection is outside v1, including an unsent number reused from history.
- **Sequence**: first workspace file viewing, then verified conversation viewing, then
  placeholder activation. Each stage must work before the next is connected. The plan owns
  implementation tasks and evidence; intermediate stages do not satisfy the whole spec.

## Acceptance

- Parser tests on sanitized, version-labelled fixtures for both agents: every source in IMG7,
  duplicate content with multiple aliases, malformed and oversized records, partial trailing
  writes, a base64 record above 8 MiB but inside the viewer/record caps, multiple images per
  record, and both plain and compressed rollouts. URL-only records never cause a fetch.
- Budget tests distinguish a complete scan, a bounded newest suffix, a compressed prefix that
  never reaches EOF, omitted old images, and a skipped oversized record. A heartbeat/IPC probe
  must keep making progress during a large scan, JSON parse and cancellation; parser unit tests
  alone do not establish responsive PTY serving.
- Pairing tests: verified identities list only their own images; same-cwd competing sessions,
  stale/conflicting facts, guessed pins, missing identity and unsupported platform sources list
  none. A foreign window, switched foreground process, closed pane or transferred pane cannot
  reuse a snapshot; renderer-supplied identity never grants access.
- Authorization tests: an out-of-workspace path found in the pane's conversation opens; the same
  path not found there is refused; a final symlink, a non-image file named `.png` and a file over
  the cap are refused. Cover original-path symlinks, ancestor escape, replacement during open
  and Windows reparse-point behavior or explicit safe refusal. A finished clone's grant works;
  a failed grant save remains recoverable. From Explorer/Changes, or a pane without IMG10 proof,
  an ungranted root requires matching picker approval; cancel and a different root do not
  authorize it. A pane with verified IMG10 proof may open that single file without a root grant,
  and does not gain access to sibling files. Relative paths with changed cwd,
  quoted paths, `~`, spaces, non-ASCII and substring lookalikes test IMG10 in both directions.
- Resource tests: a small encoded file with excessive dimensions/pixels is refused before full
  decode; aggregate preloads stay within budget; SVG size and decode failures are handled;
  rapid navigation, cancellation and close release references and ignore late replies.
- Placeholder tests: unique and repeated numbers, identical content under different numbers,
  no recorded match, and an unsent `#1` with an older recorded `#1` (the documented older-image
  result). Test a bounded suffix missing conversation-wide numbering context: it must not
  invent aliases. A limit prevents a definitive no-match result from being reported as complete.
- Viewer tests: Escape, ←/→ at both ends, Home and End are stopped before the terminal; focus
  returns to the origin; IMG14's ordering when the clicked file is and is not in the
  conversation. Append/eviction during a read cannot change a position; a source rewrite expires
  it. Test focus changing after a terminal click, Explorer click/Enter/double-click, both Changes
  entry points, deleted images, native-browser visibility and action blocking while open.
- The look is chosen from gallery specimens, and the owner approves a screenshot in the running
  app (fitted, actual size, one error state, light and dark) before the UI commit.
- [`getting-started.md`](../user/getting-started.md) (⌘+click, Explorer, Changes) and
  [`keyboard-shortcuts.md`](../user/keyboard-shortcuts.md) describe the viewer and its chord, with
  the `vi` translations updated and stamped. `CHANGELOG.md` has the entry.
- Driving the running app with Playwright happens only when the owner asks for it in that task
  (owner, 2026-10-24); that standing instruction takes the place of AGENTS.md's E2E gate here.

## Risks for the plan

- **Path matching (IMG10)**: preserve original path and source pane before `resolve_paths`;
  normalization is constrained by the occurrence's recorded context and IMG8's safe-open rule.
- **Verified identity (IMG6)**: the rail's best-effort pairing is not a reusable authorization
  service. Reuse authoritative observations, but establish and invalidate their main-owned
  binding before enabling conversation reads. Native hooks/thread locks are not available on
  every platform; do not replace missing facts with ranking.
- **Contracts**: new IPC channels keep flat payloads (R6). The authorization in IMG9–IMG11 is a
  file-access boundary; approving this spec approves that boundary, nothing wider.
- **Formats move**: neither transcript format is documented, and opencode's has already changed
  twice. Parsers fail closed per record.
- **Shell rebuild**: the [agent-first shell layout](2026-10-22-agent-first-shell-layout.md) has
  separate Changes consumers. Explorer calls `openFile`; the legacy Changes list and stacked
  dock call `diff.open` directly. Connect both explicitly, reusing one image-opening decision;
  changing the file controller alone does not implement IMG5.

## Out of scope

Other terminal gaps (separate research, 2026-10-24); `http(s)` image URLs, which the browser tab
opens; inline terminal image protocols (sixel, iTerm2, kitty); before/after comparison in
Changes; editing, annotating, copying or exporting images; PDF, GIF and video; opencode, Gemini
and other agents' transcripts, although their in-workspace image paths still open through IMG1;
Tauri.
