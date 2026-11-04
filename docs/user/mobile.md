# Mobile

The SpaceVibe Deck app for iPhone pairs with Deck on your Mac or Windows computer. From the phone
you see every pane and what it is doing, answer an agent that needs you, type into any pane, open a
new agent with a prompt, and read a checkout's files, changes and token usage. Deck on the computer
stays in charge: nothing runs on the phone, and Deck must be running for the phone to reach it.

The mobile companion is not in release builds yet. The phone app runs on iPhone; iPad runs the
iPhone layout.

## Pair a phone

1. In Deck, open **Settings** (**⌘,**, Windows: **Ctrl+,**) and go to **Mobile**.
2. Choose **Pair a phone**. Deck shows a QR code that works for five minutes and only once.
3. On the iPhone, open SpaceVibe Deck, choose **Pair a desktop** and point the camera at the code.

The phone and the computer agree on keys between themselves; there is no account and no sign-in.
Without the camera, choose **Copy code** in Deck, paste it into the phone's code field and choose
**Use code**; with Universal Clipboard the copy reaches the iPhone by itself. When the code
expires, choose **Show a new code**. One phone can pair with several computers, and
one computer with several phones.

Everything between the phone and Deck is end-to-end encrypted. It travels through SpaceVibe's
relay, which passes on sealed messages it cannot read: it sees which devices are paired, when they
connect and how big each message is, never your terminal text, files or notification text. The
[privacy notice](https://deck.spacevibe.dev/privacy) lists exactly what the relay receives.

## Use it

**Desktops** lists every paired computer, with each one's projects, checkouts and panes in the
same order and with the same marks as Deck's rail. Every pane shows its last line and how long ago
it printed, so a pane that is stuck reads as stuck even when Deck has not flagged it.

Panes that need you sit at the top under **Needs you**, newest first, with up to three shown and
**See all** for the rest:

- When an agent shows a numbered list of choices, each choice is a button. Pressing one types its
  number into that pane; you do not have to open it.
- When an agent asks a question, **Reply** sends your answer the way you would type it.
- When an agent failed, **Open** shows its pane.

Open a pane to see its terminal at the computer's size, fitted to the phone's width. Pinch or tap
the size chip to change the text size from 50 to 200%; the phone keeps it per computer. Viewing a
pane from the phone never resizes it on the computer. Inside a pane opened from Needs you, swipe or
use the dots to move to the next waiting pane.

- **Reply** at the bottom pastes your text and presses Enter, like typing on the computer.
- **Live** sends every key as you press it, for shells and for an agent's own prompts. The row above
  the keyboard adds Esc, Tab, Shift+Tab, Ctrl+C, the arrows and Return.

Approve or answer an agent by typing, as you would at the computer; the numbered buttons are the
only shortcut, and they work the same for every agent.

## Open a new agent

Choose **+** on Desktops, then a computer, a project and checkout, and an agent from that
computer's list, and optionally a first prompt. The tab opens on the computer at once without
taking its focus. The phone sends the prompt once the agent is ready. If the agent asks something
first, such as whether to trust a new folder, the phone holds the prompt and asks you to answer
that question in the pane first.

## Files, changes and usage

From a checkout, **Files** browses its folders and opens text files, **Changes** lists what changed
with lines added and removed and shows each diff, and **Usage** shows the same token and cost
numbers as Deck's usage page. All three are read-only: the phone never edits a file or runs git.

## Notifications

The phone gets a notification when an agent needs you or finishes, unless a Deck window is in
front of you on the computer. Turn them on or off in the phone app's **Settings** →
**Notifications**; Deck's own notification setting on the computer does not affect the phone.
Notifications are encrypted like everything else. If one cannot be opened, it reads "An agent
needs you". Tap it to open that pane.

Encrypted notifications need the installed app. When you try the app through Expo Go, a
notification shows only "An agent needs you" until you open the app.

## Offline, locked and revoked

- **Offline.** When Deck is closed or the computer cannot be reached, the phone shows that computer
  as offline with when it was last seen, and reconnects on its own when Deck is back.
- **Keeping the computer awake.** While an agent is working and a phone is paired, Deck keeps the
  computer from sleeping. Closing a laptop's lid on battery still puts it to sleep.
- **Same network.** When the phone and the computer are on the same Wi-Fi, the phone connects
  directly, and the computer's details on the phone say so. On the first direct connection your
  computer's firewall may ask whether Deck may accept incoming connections; declining only means the
  phone keeps using the relay. Leaving the network moves the phone back to the relay by itself.
- **Face ID.** The app asks for Face ID or your passcode when it opens and after five minutes in the
  background. Turn this off in the phone app's **Settings** → **Unlock with Face ID**.
- **Revoke.** In Deck's **Settings** → **Mobile**, **Revoke** removes a phone. Within seconds that
  phone shows the computer as revoked and can no longer reach it. On the phone, **Forget this
  desktop** does the same from the other side.
- **Updates.** When the phone app and Deck are too far apart in version, the phone says which one
  to update: Deck through its updater, the app through TestFlight or the App Store.

## On Windows

Everything above works with Deck on Windows. Deck on Windows has no agent hooks, so it learns that
an agent needs you only from what the agent prints. It can miss that moment: then the pane is not
pinned under Needs you and no notification comes, but the pane still shows its last line and age in
the tree.
