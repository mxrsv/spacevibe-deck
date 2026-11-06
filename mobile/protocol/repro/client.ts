/**
 * The no-phone repro client: pairs, subscribes, sends and reads through the real relay protocol
 * and the real secure channel, so a desktop-side bug can be reproduced without an iPhone.
 *
 *   npm run repro -- pair "<qr text>"
 *   npm run repro -- tree
 *   npm run repro -- watch <paneId>
 *   npm run repro -- send <paneId> <text>
 *   npm run repro -- input <paneId> <data>       (\r \n \t \e \xHH \\ are interpreted)
 *   npm run repro -- read <paneId> [lines]
 *   npm run repro -- open <projectPath> <checkoutPath> <agent> [prompt]
 *   npm run repro -- revoke
 *
 * `--store <path>` picks the pairing file (default ./.deck-repro.json, mode 0600, plaintext keys).
 */
import { b64urlEncode } from "../src/encoding";
import { deriveClaimToken } from "../src/keys";
import { createPairHello, openPairAccept } from "../src/pairing";
import { PROTOCOL_VERSION } from "../src/version";
import { parsePairingQr } from "../src/qr";
import { parseResult } from "../src/results";
import type { Tree } from "../src/tree";
import { unescapeInput } from "./input-escapes";
import { connect, crypto, openRelaySocket, relayErrorText, type Connection } from "./connection";
import { DEFAULT_STORE, deletePairing, loadPairing, savePairing, type ReproPairing } from "./store";

const USAGE = `Usage: npm run repro -- [--store <file>] <command>
  pair "<qr text>"                      pair with a desktop showing a QR
  tree                                  print projects, checkouts and panes
  watch <paneId>                        print the snapshot, then live output (Ctrl-C to stop)
  send <paneId> <text>                  send text to an agent and submit it
  input <paneId> <data>                 raw keystrokes (\\r \\n \\t \\e \\xHH \\\\ are interpreted)
  read <paneId> [lines]                 print the last lines of a pane (default 50)
  open <projectPath> <checkoutPath> <agent> [prompt]
  revoke                                forget this pairing on the relay and delete the file`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requirePairing(file: string): ReproPairing {
  const pairing = loadPairing(file);
  return pairing ?? fail(`No pairing in ${file}. Run: npm run repro -- pair "<qr text>"`);
}

function paneIdArg(value: string | undefined): number {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 0 ? id : fail("paneId must be a non-negative integer");
}

async function pair(file: string, qrText: string): Promise<void> {
  const scanned = parsePairingQr(qrText, Date.now());
  if (!scanned.ok) fail(`That QR is not usable: ${scanned.reason}`);
  const qr = scanned.value;
  const phoneToken = crypto.randomBytes(32);
  const socket = await openRelaySocket(qr);
  socket.sendControl({
    t: "claim",
    claimToken: b64urlEncode(deriveClaimToken(crypto, qr.secret)),
    phoneTokenHash: b64urlEncode(crypto.sha256(phoneToken)),
  });
  const ready = await socket.control.next(
    (item) => item.t === "ready" || item.t === "error",
    "the relay to accept the claim",
  );
  const text = relayErrorText(ready);
  if (text !== null) fail(text);

  const attempt = createPairHello(crypto, qr, {
    name: "deck-repro",
    model: "repro",
    os: process.platform,
    v: PROTOCOL_VERSION,
  });
  socket.ws.send(attempt.frame);
  const answer = await socket.binary.next(() => true, "the desktop's answer", 60_000);
  const result = openPairAccept(crypto, attempt, answer);
  socket.ws.close(1000);
  if (!result.ok) fail(`The desktop refused the pairing: ${result.reason}`);

  savePairing(file, {
    version: 1,
    relayUrl: qr.relayUrl,
    pairingId: qr.pairingId,
    desktopName: result.desktop.name,
    pairedAt: Date.now(),
    phoneToken: b64urlEncode(phoneToken),
    pairKey: b64urlEncode(attempt.pairKey),
  });
  console.log(`Paired with ${result.desktop.name} (Deck ${result.desktop.appVersion}).`);
}

function printTree(tree: Tree): void {
  for (const project of tree.projects) {
    console.log(`${project.name}  ${project.path}`);
    for (const checkout of project.checkouts) {
      console.log(`  ${checkout.name}${checkout.branch === null ? "" : ` (${checkout.branch})`}`);
      for (const pane of checkout.panes) {
        const flag = pane.attention === "none" ? "" : ` [${pane.attention}]`;
        console.log(
          `    #${pane.paneId} ${pane.title}  ${pane.agentLabel ?? "shell"}  ${pane.phase}${flag}  ${pane.lastLine}`,
        );
      }
    }
  }
}

async function watch(connection: Connection, paneId: number): Promise<void> {
  let sub = "";
  connection.onEvent((event) => {
    if ((event.ev === "term.snapshot" || event.ev === "term.data") && event.p.sub === sub) {
      process.stdout.write(event.p.data);
    } else if (event.ev === "term.end" && event.p.sub === sub) {
      console.error(`\n[pane ended: ${event.p.reason}]`);
      process.exit(0);
    }
  });
  // The subscription id arrives in the response, but the first snapshot chunk can race ahead of
  // it, so match the first snapshot's sub too.
  connection.onEvent((event) => {
    if (sub === "" && event.ev === "term.snapshot") sub = event.p.sub;
  });
  const { r } = await connection.request("pane.subscribe", { paneId });
  const result = parseResult("pane.subscribe", r);
  if (result === null) fail("The desktop answered pane.subscribe with something unexpected.");
  sub = result.sub;
  console.error(`[watching pane ${paneId} at ${result.cols}x${result.rows}; Ctrl-C to stop]`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    connection.socket.ws.addEventListener("close", () => resolve());
  });
  await connection.request("pane.unsubscribe", { sub }).catch(() => undefined);
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  let file = DEFAULT_STORE;
  const flagAt = args.indexOf("--store");
  if (flagAt >= 0) {
    file = args[flagAt + 1] ?? fail("--store needs a path");
    args.splice(flagAt, 2);
  }
  const [command, ...rest] = args;

  if (command === "pair") return pair(file, rest[0] ?? fail(USAGE));
  if (command === "revoke") {
    const pairing = requirePairing(file);
    const socket = await openRelaySocket(pairing);
    socket.sendControl({ t: "auth", role: "phone", token: pairing.phoneToken });
    socket.sendControl({ t: "revoke" });
    await socket.control
      .next((item) => item.t === "revoked" || item.t === "error", "the relay to revoke")
      .catch(() => undefined);
    socket.ws.close(1000);
    deletePairing(file);
    console.log("Revoked and deleted the local pairing.");
    return;
  }
  if (!["tree", "watch", "send", "input", "read", "open"].includes(command ?? "")) fail(USAGE);

  const connection = await connect(requirePairing(file));
  try {
    switch (command) {
      case "tree": {
        const { r } = await connection.request("tree.subscribe", {});
        const result = parseResult("tree.subscribe", r);
        if (result === null) fail("The desktop sent a tree this client cannot read.");
        printTree(result.tree);
        await connection.request("tree.unsubscribe", {});
        break;
      }
      case "watch":
        await watch(connection, paneIdArg(rest[0]));
        break;
      case "send": {
        const text = rest.slice(1).join(" ");
        const { r } = await connection.request("pane.send", {
          paneId: paneIdArg(rest[0]),
          text,
          submit: true,
        });
        console.log(parseResult("pane.send", r)?.outcome ?? "sent");
        break;
      }
      case "input":
        await connection.request("pane.input", {
          paneId: paneIdArg(rest[0]),
          data: unescapeInput(rest.slice(1).join(" ")),
        });
        break;
      case "read": {
        const lines = rest[1] === undefined ? 50 : Number(rest[1]);
        const { r, body } = await connection.request("pane.read", {
          paneId: paneIdArg(rest[0]),
          lines,
        });
        console.log(body ?? parseResult("pane.read", r) ?? "");
        break;
      }
      case "open": {
        const [projectPath, checkoutPath, agent, ...prompt] = rest;
        if (!projectPath || !checkoutPath || !agent) fail(USAGE);
        const { r } = await connection.request("pane.open", {
          projectPath,
          checkoutPath,
          agent,
          prompt: prompt.length > 0 ? prompt.join(" ") : null,
        });
        console.log(`Opened pane ${parseResult("pane.open", r)?.paneId ?? "?"}`);
        break;
      }
    }
  } finally {
    connection.close();
  }
}

run().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
