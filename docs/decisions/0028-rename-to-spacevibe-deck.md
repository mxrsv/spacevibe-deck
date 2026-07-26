---
id: 0028
title: "Rename Stackgrid → SpaceVibe Deck"
date: 2026-07-26
kind: product
affects: [PRD]
supersedes: []
---

# ADR 0028 — Rename Stackgrid → SpaceVibe Deck

## Context

The product ships as `Stackgrid` from the repo `mxrsv/stackgrid`, under the bundle identifier `com.kyantran.stackgrid`. It is one of five projects being gathered under a single home at `spacevibe.dev`, each getting a subdomain and a `spacevibe-` repo prefix. `Stackgrid` is the only one of the five whose name says nothing about what it is, and it does not sit in the same naming family as its siblings (Arena, Studio, Hub).

There is no auto-updater and the repo has a single star, so the identifier change costs the least it will ever cost. Deferring it makes it strictly more expensive.

## Decision

The product is **Deck** in prose and **`SpaceVibe Deck`** as the shipped bundle — the same relationship "VS Code" has with "Visual Studio Code". Prose gets the short name because the surrounding context already says SpaceVibe; the bundle carries the full one because `/Applications` is shared with everyone else's software and has to be self-identifying.

- Repo `mxrsv/stackgrid` → `mxrsv/spacevibe-deck`; GitHub redirects the old URL, so existing clones keep working.
- Tauri `productName` → `SpaceVibe Deck`, npm and Cargo package names → `spacevibe-deck`.
- Bundle identifier `com.kyantran.stackgrid` → `dev.spacevibe.deck`.
- Home page moves from the GitHub repo to `deck.spacevibe.dev`.

The window title stays dynamic per workspace and is untouched by this; only the static fallback title changes.

**Settings survive the identifier change.** The app data directory is keyed by the bundle identifier, so the rename would otherwise read as a factory reset to every existing install. A one-time migration at startup copies the old identifier's directory to the new one, and only when the new one does not exist yet. It copies rather than moves, so a downgrade to 0.7.x still finds its own settings; a partial copy is rolled back so a failed attempt retries on the next launch instead of stranding half the state.

## Consequences

- PRD's product name and install instructions change; the app's behavior, model and scope do not. `affects` is narrowed to `[PRD]` for that reason — this is an identity decision, not a product-intent, flow, architecture, UI or requirements one.
- `src-tauri/src/migrate.rs` exists solely to serve this ADR and can be deleted once no install predating 0.8.0 plausibly remains.
- Prior ADRs keep saying "Stackgrid". They are append-only records of decisions made under that name and are not rewritten; this ADR is the one place the mapping is stated.
- Marketing reads the display name from `marketing/stage/brand.js`, where `name` ("Deck") and `bundlePath` ("SpaceVibe Deck.app") intentionally differ per the rule above.

## Options rejected

- Keeping `Stackgrid` and only adding the subdomain — leaves one of five products off the naming family for no gain, and the identifier cost only grows with install base.
- Naming the bundle plain `Deck` — too generic for `/Applications`, where it sits next to everyone else's software rather than inside SpaceVibe's context.
- Keeping the old identifier to protect existing settings — pins a name the product no longer uses into every future install's data path, to avoid a migration that is a few dozen lines and testable.
- Moving instead of copying the settings directory — saves nothing and makes a downgrade lose state.
