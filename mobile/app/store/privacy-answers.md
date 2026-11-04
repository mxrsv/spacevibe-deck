# App Store Connect: App Privacy answers

For the owner to enter by hand in App Store Connect, App Privacy. They match the
[2026-11-05 privacy notice](../../../marketing/public/privacy/2026-11-05/index.html), section
"Mobile companion" (spec MOB26). Re-check them whenever that section changes.

## Facts the answers rest on

- The app has no account, no sign-in, no third-party SDK for analytics, ads or crash reports, and
  sends no analytics or diagnostics of its own (spec decision 18).
- Terminal text, file contents, prompts and notification copy are end-to-end encrypted between the
  phone and the desktop. The relay never has the keys, so SpaceVibe cannot read them.
- The relay stores, per pairing, until the user revokes it or an unclaimed code expires: a random
  pairing id, hashes of the auth secrets, timestamps (created, expires, last seen) and the push
  token (APNs, or Expo's in Expo Go). It does not store frames, push payloads or IP addresses.
- Cloudflare handles IP addresses while delivering requests; neither the app nor the relay records
  them.
- Pushes go through Apple's push service (Expo's when running in Expo Go) with a generic line and
  ciphertext.

## Answers

**Do you or your third-party partners collect data from this app?** Yes. Reasoning: Apple counts
data as collected when it is sent off the device and kept longer than needed to serve the request in
real time. The push token and pairing id are kept until revocation, so "Data Not Collected" would
overstate. Everything else below is not collected.

| Data type | Collected | Linked to the user | Used for tracking | Purpose |
| --- | --- | --- | --- | --- |
| Identifiers > Device ID (the push token and the pairing id) | Yes | No | No | App Functionality |
| Everything else (contact info, health, financial, location, sensitive info, contacts, user content, browsing history, search history, purchases, usage data, diagnostics, other data) | No | n/a | n/a | n/a |

Why "not linked": there is no account, name, email or Apple ID on the relay, and the pairing id and
push token cannot be tied to a person by SpaceVibe. Why "User Content" is "No": the content is
encrypted end to end and unreadable to SpaceVibe, and Apple does not count data a developer cannot
access. Why "Usage Data" and "Diagnostics" are "No": the phone sends none; the desktop's counters
are the desktop app's disclosure, not this app's.

**Tracking:** the app does not track. No ATT prompt, no `NSUserTrackingUsageDescription`.

**Privacy policy URL:** `https://deck.spacevibe.dev/privacy`

## Open point for the owner

If Apple review reads the push token as "not collected" (it is only passed to Apple's own
service), "Data Not Collected" would also be defensible. The conservative answer above is the
recommended one because the relay keeps the token on its own servers.
