# Feedback: required sign-in and status mail

Date: 2026-10-08
Status: Draft — decisions 1–3 taken by the owner 2026-10-08; awaiting approval before
implementation.
Owner checkout: `/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Baseline: `main` at `67d20660` (Supabase feedback intake, public Pending board).
Surfaces: the [backend Worker](../../backend/README.md#feedback) and the landing feedback page
(`marketing/landing-prototype/`). The desktop app is untouched.

## Purpose

Today anyone can post feedback anonymously, and the owner changes `status` in Supabase Studio
with no way to tell the author. This slice makes every new report belong to a signed-in user,
so intake can be controlled per person, and emails that user when the owner moves their report
forward.

## Decisions (owner, 2026-10-08)

1. **Sign-in is required** to submit. Existing anonymous reports stay on the board unchanged;
   they have no recipient and never get mail.
2. **Google sign-in, reusing the dormant implementation.** The landing's
   [`feedback-auth.js`](../../marketing/landing-prototype/src/feedback-auth.js) and the
   Worker's [`feedback-auth.mjs`](../../backend/src/feedback-auth.mjs) are wired into the
   Supabase path. Turned down: Supabase Auth (adds an anon key and a session to the landing)
   and email magic links (new sending and abuse surface). Consequence: only Gmail and
   verified Google Workspace addresses can sign in, because that address becomes the mail
   recipient (`validClaims`).
3. **Mail on `→ review` and `→ done` only.** No mail for `hidden` or for a move back to
   `pending`.

## Requirements

### Sign-in

- **FBA1.** The landing form requires Google sign-in before it can send; the board stays
  readable without signing in.
- **FBA2.** The Worker rejects a submission without a valid Google ID token with 401 and
  stores nothing. A 401 keeps the browser draft.
- **FBA3.** Each stored report records the author's Google `sub` and verified email. Neither is
  ever returned by the board or image routes.
- **FBA4.** Submission rate limiting is keyed per user (`sub`), replacing the shared anonymous
  key; the 100-per-24h database guard stays.
- **FBA5.** Sign-in mode is its own Worker switch, independent of `FEEDBACK_STORAGE`. With
  sign-in on and `GOOGLE_CLIENT_ID` missing, intake reports closed rather than falling back to
  anonymous.

### Status mail

- **FBM1.** When `status` changes to `review` or `done` on a ready report that has an email,
  exactly one mail per (report, status) is queued — set by a database trigger, because the
  owner edits status in Studio where no app code runs. Flipping a status away and back does
  not queue a second mail.
- **FBM2.** The Worker's existing every-minute cron drains the queue through Resend, reusing
  the idempotency-key and 23-hour safe-retry rules of
  [`feedback-mail.mjs`](../../backend/src/feedback-mail.mjs). Overlapping runs cannot send the
  same row twice.
- **FBM3.** The queue references the report, not a copy of the address; the address is read at
  send time. Erasing the report (or its email) cancels pending mail. A report that is `hidden`
  at send time is skipped.
- **FBM4.** The mail states the report title, its new status in plain words ("in progress" /
  "done") and links to the board. English copy (R1). It says why the user received it.
- **FBM5.** Failures are retried without logging addresses or report text; a row past the
  retry window is marked for owner review instead of resent.

### Privacy and docs

- **FBP1.** A new dated privacy notice under `marketing/public/privacy/<date>/` discloses the
  Google account email and ID, their use for status mail, Resend as processor, and erasure;
  `/privacy` points at it and the 2026-10-08 notice is kept.
- **FBP2.** [`backend/README.md`](../../backend/README.md#feedback) describes sign-in, the mail
  queue, setup switches and the erasure steps (report, images, queued mail).

## Acceptance criteria

- Signed out: the form cannot send; a forged or expired token gets 401 with no row created.
- Signed in: a report is stored with `sub` and email; the board JSON and image responses
  contain neither (test).
- Studio `pending → review` queues one mail; `review → done` queues a second; `done → review`
  and `review → pending → review` queue nothing new (migration test or SQL check).
- The cron sends a queued mail once through Resend; a simulated provider failure retries; two
  concurrent drains send once (backend tests with a stubbed `fetch`).
- Backend and landing test suites pass; the landing sign-in → submit flow is walked in a real
  browser against a local Worker.

## Out of scope

- Per-user notification opt-out or an account page; mail is transactional, one per status.
- Editing or deleting one's own report from the landing.
- Moving status changes out of Supabase Studio.
- Reviving the D1/Linear path (Linear is retired); it stays dormant.

## Owner actions before launch

- Verify the sending domain in Resend; set `RESEND_API_KEY` as a Worker secret and choose the
  `FEEDBACK_EMAIL_FROM` address.
- Create a Deck-only Google OAuth web client (owner, 2026-10-08: reusing GiffCoffee's client
  was turned down — it shares infrastructure across repos and brands the consent screen as
  GiffCoffee). Deck needs only the client ID, no client secret. Add `https://deck.spacevibe.dev`,
  `http://localhost:5173` and `http://127.0.0.1:5173` as authorized JavaScript origins; supply
  `GOOGLE_CLIENT_ID`.
- Run the new Supabase migration (`db push`) before deploying the Worker.
