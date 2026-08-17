# Session-tail parsing — what the real corpus says

Measured 2026-08-17 against this machine's own `~/.claude`, `~/.codex` and
`~/.local/share/opencode` corpora, to answer one question: can the rail show
**the newest message of a pane's conversation, from either side, accurately?**

Short answer: yes for `claude`, `codex` and `opencode`. The rules below are
derived from counted records, not from a published schema — none of these
formats has one.

## 1. Ordering: reading backwards from EOF is correct

This was the finding that mattered most, because it nearly went the other way.

**Claude transcripts are NOT globally sorted by time.** Of the 20 newest
transcripts, **18 contain records whose `timestamp` goes backwards** relative to
the line before (1 to 79 backward steps per file). A parser that assumed file
order equals chronology would be assuming something false.

But the disorder is in the MIDDLE, not at the end:

| Check, over the 30 newest transcripts    | Result                       |
| ---------------------------------------- | ---------------------------- |
| last timestamped record == max timestamp | **29 / 30**                  |
| same, restricted to `user` + `assistant` | **29 / 30**                  |
| the single mismatch, both checks         | 6 ms and 1 ms — same instant |

So [`tailBytes`](../../electron/resume/head.ts)'s backwards read is sound and
needs no change. Sorting the window by `timestamp` before picking is free
insurance against the 6 ms case, nothing more. **Do not** rewrite the reader to
sort the whole file.

Codex rollouts sampled were sorted, last == max.

## 2. Claude: 11 record types at the tail, not 2

Counted over the last 400 records of a live transcript:

```
126 assistant     87 attachment    80 user      20 mode
 20 last-prompt   20 bridge-session 20 ai-title 10 queue-operation
  9 system         5 file-history-snapshot       3 file-history-delta
```

### Accept

- `type === "assistant"` → content parts with `type === "text"`.
- `type === "user"` → content that is a plain string, or a `{ type: "text" }`
  part.

### Reject, each for a measured reason

| Rule                                          | Why, with the count                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| assistant part `type !== "text"`              | parts are `tool_use` 67, **`thinking` 43**, `text` 13. `thinking` is the model's internal reasoning — it must never reach a rail row.                           |
| user content that is `tool_result`            | **67 of 79** user records (85%) are the transcript echoing a tool back. "Newest user record" is wrong 85% of the time.                                          |
| `isMeta === true`                             | catches `<local-command-caveat>` blocks and skill-injection bodies.                                                                                             |
| user text where `trimStart().startsWith("<")` | **10.8%** of the 2058 user texts that survive `isMeta` still start with `<` — `<command-name>`, `<local-command-stdout>`. `isMeta` alone is NOT enough.         |
| `isSidechain === true`                        | a subagent's conversation, not the pane's. 0 in the 30 newest here, but the field is present on every user/assistant record and `subagents/` transcripts exist. |
| every other `type`                            | `attachment`, `system`, `mode`, `bridge-session`, `ai-title`, `queue-operation`, `file-history-*` carry no turn.                                                |

[`claudeUserText`](../../electron/resume/claude.ts) already implements the
string/`text`-part half and is the right thing to reuse. It does **not** check
`isMeta`, `isSidechain` or the `<` prefix — those three are additions.

### The trap: `last-prompt` looks like a free answer and is not

Claude writes a dedicated record, present in **30 of 30** transcripts:

```json
{ "type": "last-prompt", "lastPrompt": "…", "leafUuid": "…", "sessionId": "…" }
```

It reads like a purpose-built "newest user prompt" field. It is not usable:

- it carries **no `timestamp`**, so it cannot be ordered against anything;
- it is **written repeatedly** — 3 identical copies in one 22-record tail;
- measured on a live transcript, the **last** `last-prompt` in the file named an
  OLDER prompt (`[Image #7] lựa chọn…`, ~05:42) than the newest real user
  record (`hey`, 07:41:52).

It points at a leaf in the `uuid`/`parentUuid` graph, not at "most recent". Use
the message records.

## 3. Codex: two encodings, one of them legacy

- **`response_item` + `payload.type === "message"` is the current encoding.**
  [`codexTailFromLines`](../../electron/resume/session-tail.ts) already reads
  this. No change needed for the assistant side.
- **`event_msg` + `agent_message` / `user_message` is legacy.** It carried 133
  agent messages in a rollout from 2026-08-05, and **0 in most of the 15 newest
  rollouts**. Worth tolerating for old sessions; worth nothing as the primary
  path.

### `role: "developer"` is the Codex-specific trap

Across the 15 newest rollouts: `role=user` **29**, `role=developer` **40**.
Developer records are injected instructions (AGENTS.md renders, tool
instructions) and **outnumber real user turns**. Today's parser is safe only
because it demands `role === "assistant"`; the moment user turns are accepted,
`developer` must be rejected explicitly.

Content parts are `input_text` for user, `output_text` for assistant.

Injected user text needs a **wider filter than Claude's**: of 8321 user text
lines, 466 start with `<` and **404 start with `#`** — the
`# AGENTS.md instructions for <path>` block.
[`codexUserText`](../../electron/resume/codex.ts) rejects `<` already; `#` is
new, and it carries a real false-positive risk (a person can type a markdown
heading). Prefer matching the known injected prefixes over a bare `#`.

## 4. opencode is supportable, but it is a directory read

Not a tail. Two files per message:

```
storage/message/<sessionID>/<messageID>.json  → { id, role, sessionID, time }
storage/part/<sessionID>/<messageID>/<partID>.json → { type, text, time, … }
```

Part types over 300 sampled: `tool` 73, `step-start` 60, `step-finish` 60,
**`text` 57**, `reasoning` 35, `patch` 14, `agent` 1. Accept `text`; reject
`reasoning` for the same reason as Claude's `thinking`.

`role` comes from the message file, `time` orders both levels. This does not fit
`tailBytes(filePath, cap)` — it needs "newest N part files by mtime, then their
message's role". A real but separate piece of work.

## 5. Not researched / not supportable

- **agy** — `.pb` protobuf with no documented schema. Stays null, as recorded.
- **gemini** — `~/.gemini/tmp/<hash>/logs.json` exists; not surveyed. Gemini also
  resumes by `--resume latest` with no id, so pane→session identity is weaker
  here than for the others.

## 6. What this means for the rail

1. Accuracy is achievable and the backwards read stays.
2. Accepting user turns is what makes "newest message, either side" work — and it
   is exactly where the sharp edges are (85% tool results, injected blocks,
   `developer` records).
3. `thinking` / `reasoning` parts must never surface. They are the model's
   private reasoning, and a rail row is a public surface.
4. None of this fixes the gate: while a pane is `hasRun === false` the store
   asks for nothing, so no parser change is observable. That is a separate
   decision, recorded with the bug.

## Chưa khớp thực tế

| Claim                                 | Intent     | Status     | Evidence                                              |
| ------------------------------------- | ---------- | ---------- | ----------------------------------------------------- |
| The shipped parser accepts user turns | `decided`  | not built  | today it demands `assistant` / `role === "assistant"` |
| opencode produces a tail              | `decided`  | not built  | §4 above; needs a directory reader, not `tailBytes`   |
| These rules hold on Windows corpora   | `building` | unverified | measured on macOS only (Gate C)                       |
