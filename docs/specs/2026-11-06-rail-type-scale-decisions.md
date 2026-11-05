# Rail type scale: decision ledger (2026-11-06)

Source: grilling session with the owner, screenshot of the project rail (`src/ui/project-rail/`).
Rows marked (default) were not answered by the owner and take the recommended answer.

| ID | Decision | Owner words / status |
|----|----------|----------------------|
| RL-1 | Work in `spacevibe-deck` on `main` | (default) |
| RL-2 | Names (project, session, branch, `Search`, remembered rows) go 14px → 13px; meta lines (`No sessions`, `1d`, sub-line) stay 12px | "giảm tỉ lệ chữ ... hơi lớn" + (default) |
| RL-3 | A rail-only type token, not an app-wide `text-sm` change | (default) |
| RL-4 | Row height and leading shrink with the text | "có giảm chiều cao và leading" |
| RL-5 | Rows 32 → 28 and 44 → 40; add `--row-28`, `--row-40` | (default) |
| RL-6 | Name leading 20 → 18px (`--leading-rail`); meta leading stays 16px | (default) |
| RL-7 | New tokens live in `01-tokens.css` next to RCP-5/RCP-7; update `composition-rules.test.ts` and the RCP spec | (default) |
| RL-8 | A workspace with no logo shows the app folder glyph (`FEATURE_ICON`, 15px) instead of initials | (default) |
| RL-9 | The logo box is 16px (`size-4`) | "giảm size logo workspace xuống 16px" |
| RL-10 | Every logo, real or fallback, sits in one 16px box that is a fixed square mould with no border and no fill: the logo covers it and is clipped by it, no padding, so a round logo still shows square | "logo phải nằm trong 1 box" + "box để logo nằm trong 1 khuôn nhất định, không phải box có padding" |

## Acceptance (each ID)

- RL-2/3: computed `font-size` of a name is 13px, of a meta line 12px; no other surface changed (W21: list all `text-sm` sites, report changed N of M).
- RL-4/5/6: measured row heights 28 / 40, leading 18 / 16 in the running dev app (W22).
- RL-7: ratchet tests pass with the new tokens and still fail an off-scale literal.
- RL-8/9/10: `spacevibe-academy` (real logo), `spacevibe-board` (no logo) and `kyantran` (one-letter name) all render a 16px square box without border; no initials anywhere.
