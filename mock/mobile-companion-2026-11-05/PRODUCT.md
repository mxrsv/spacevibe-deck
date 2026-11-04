# Product

<!-- impeccable:product-schema 1 -->

Source: confirmed by the owner in chat on 2026-11-04 (intent interview plus four grilling
rounds), recorded in `spacevibe-deck/docs/specs/2026-11-04-mobile-companion.md`. This file
lives beside the direction mock in scratch, not in the repo.

## Platform

ios

## Stack

Expo (React Native), xterm.js inside a WebView for the terminal. Decided by the owner.

## Users

Developers who run several AI agent CLIs (Claude Code, Codex, opencode) side by side in SpaceVibe
Deck on a Mac or Windows desktop. On the phone they are away from the desk, on the sofa or out of
the house. They want to know which agent needs them, unblock it, and get back to their day.
They open the app in short bursts, often from a push notification.

## Product Purpose

A companion that pairs with a running Deck and lets the phone see every pane and its state, type
into any pane (including a live keystroke mode), answer and approve agents, open a new agent with
a prompt, and read files, changes and token usage. Push arrives when an agent needs the user or
finishes. The desktop stays the source of truth: the phone is a view and a keyboard. Success:
an agent waiting on a question is answered from the phone within seconds of the push.

## Positioning

Deck already knows each pane's phase and attention from agent hooks, so the phone can say "this
agent needs you" rather than show a terminal list. Pairing is a QR scan with no account, and
every byte is end-to-end encrypted through the relay.

## Constraints

- English only (R1). No marketing copy in the app.
- Free. iPhone first; iPad runs the iPhone layout.
- Desktop must be running; the phone shows it offline otherwise.
- Face ID or passcode to open the app, on by default.
- Visual system inherits SpaceVibe Deck's tokens and recipes (graphite dark, Deck Light).

## Terminology

- **Desktop:** a computer running Deck, paired with this phone.
- **Project → checkout → pane:** the same tree Deck's rail shows.
- **Needs you / working / done / failed / idle:** pane attention and phase.
- **Live mode:** each keystroke goes straight to the pane's terminal.
