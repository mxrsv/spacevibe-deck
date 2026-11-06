/**
 * xterm answers terminal queries and reports modes by itself (device attributes, cursor position,
 * focus and mouse reports, colour and capability replies). The desktop's own terminal already does
 * that for the agent, so forwarding the phone's copy would type garbage into the agent as
 * duplicate input. These are matched and removed; every real key (arrows `ESC [ A`, `ESC [ Z`,
 * function keys `ESC [ 15 ~`, `ESC O P`, ...) is left alone.
 */
const ESC = "\u001b";
const BEL = "\u0007";
const ST = `${ESC}\\`;

const REPLIES: readonly RegExp[] = [
  // Device attributes: DA1 `ESC [ ? … c`, DA2 `ESC [ > … c`, DA3 `ESC P ! | … ST`.
  new RegExp(`${ESC}\\[[?>=][0-9;]*c`, "g"),
  new RegExp(`${ESC}P!\\|[0-9A-Fa-f]*${ESC}\\\\`, "g"),
  // Cursor position and device status reports: `ESC [ r ; c R`, `ESC [ ? … n`, `ESC [ 0 n`.
  new RegExp(`${ESC}\\[\\??[0-9;]*[Rn]`, "g"),
  // Mode reports (DECRPM) and window reports.
  new RegExp(`${ESC}\\[\\??[0-9;]*\\$y`, "g"),
  new RegExp(`${ESC}\\[[0-9;]*t`, "g"),
  // Focus reports.
  new RegExp(`${ESC}\\[[IO]`, "g"),
  // Mouse reports: X10 `ESC [ M b x y`, SGR `ESC [ < … M|m`, urxvt `ESC [ b ; x ; y M`.
  new RegExp(`${ESC}\\[M[\\s\\S]{3}`, "g"),
  new RegExp(`${ESC}\\[<[0-9;]*[Mm]`, "g"),
  new RegExp(`${ESC}\\[[0-9]+;[0-9]+;[0-9]+M`, "g"),
  // OSC replies (colours, clipboard), ended by BEL or ST.
  new RegExp(`${ESC}\\][\\s\\S]*?(?:${BEL}|${ST.replace(/\\/g, "\\\\")})`, "g"),
  // DCS replies (DECRQSS, XTGETTCAP), ended by ST.
  new RegExp(`${ESC}P[\\s\\S]*?${ESC}\\\\`, "g"),
];

/** `data` without any terminal-generated reply or report; "" when nothing but those was there. */
export function filterInput(data: string): string {
  if (!data.includes(ESC)) return data;
  let out = data;
  for (const pattern of REPLIES) out = out.replace(pattern, "");
  return out;
}
