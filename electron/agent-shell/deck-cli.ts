/**
 * The `deck` command Deck writes into the agent-shell bin directory (spec
 * 2026-11-03-agent-orchestration, ORC1-5).
 *
 * A POSIX `sh` script that needs only `curl`, like the hook scripts: it parses its arguments,
 * posts them form-encoded to `/control/v1/<group>/<verb>` on the hook listener with the pane id,
 * the pane token and the tty of the agent process that runs it, prints Deck's answer and maps the
 * HTTP status to an exit code. Every decision and all text formatting happen in main, so there is
 * no Node entry point to bundle.
 *
 * - **Identity.** The pane variables are the three `DECK_*` ones; a Codex daemon subcommand or an
 *   opencode with Signals off has them stripped by its wrapper, and the script says so (exit 3).
 * - **tty.** One `ps` lookup on `DECK_AGENT_PID` (the wrapper's agent pid, which keeps the pane's
 *   terminal even when an agent runs the command from a tool shell with none), else on the
 *   script's parent. The Codex hook script walks up looking for a process named `codex`; this
 *   command is run by Claude, Codex, opencode or the pane's own shell alike, so it cannot.
 * - **Arguments** travel as `--data-urlencode name=value`, so the shell never builds JSON and a
 *   value that starts with `@` is data, not a file. `name@-` is used only to read stdin.
 * - **Exit codes.** 0 done; 1 refused, failed or Deck is not answering; 2 usage; 3 outside a pane;
 *   124 timed out. A 202 means "ask again", which is how `wait` long-polls.
 * - **`curl -q` comes first** so a user's `~/.curlrc` cannot add options; `--noproxy` keeps the
 *   pane token away from a proxy.
 */

/** The file name in the bin directory, which is the command's name. */
export const DECK_CLI_FILE = "deck";

/**
 * Above the slowest answer Deck can give, so curl never gives up before Deck does: a worktree
 * add is 60 s of git plus the git calls that inspect an interrupted checkout, and one slice of a
 * `wait` is 60 s.
 */
const CURL_TIMEOUT_S = 95;

export function deckCliSource(): string {
  return `#!/bin/sh
# deck: control SpaceVibe Deck from inside one of its panes. Written by Deck at boot; edits are lost.
# POSIX sh and curl only: every decision and all formatting happen in Deck.

CURL_TIMEOUT=${CURL_TIMEOUT_S}
DEFAULT_WAIT=600
MAX_WAIT=3600

usage_line() {
  case $1 in
    'status') printf '%s\\n' 'status' ;;
    'worktree create') printf '%s\\n' 'worktree create --repo <path> --branch <name> [--dest <path>]' ;;
    'pane list') printf '%s\\n' 'pane list' ;;
    'pane open') printf '%s\\n' 'pane open --cwd <path> --agent <id> [--prompt <text>] [--name <label>]' ;;
    'pane send') printf '%s\\n' 'pane send <id> [--no-submit] (<text> | --stdin)' ;;
    'pane read') printf '%s\\n' 'pane read <id> [--lines <n>] [--envelope]' ;;
    'pane wait') printf '%s\\n' 'pane wait <id> --for idle|needs-you|exited|turn [--timeout <s>]' ;;
    'pane close') printf '%s\\n' 'pane close <id> [--force]' ;;
    'skill orchestrate') printf '%s\\n' 'skill orchestrate' ;;
  esac
}

describe() {
  case $1 in
    'status') printf '%s\\n' 'Show the Deck version and this pane, with the window it lives in.' ;;
    'worktree create') printf '%s\\n' 'Run git worktree add on a new branch and print the path. --dest defaults to a folder named after the branch, next to the repository.' ;;
    'pane list') printf '%s\\n' 'List the panes in this window with their agent, phase and attention.' ;;
    'pane open') printf '%s\\n' 'Open a new tab with an agent at --cwd and print the new pane id. --prompt is sent once the agent first reads idle.' ;;
    'pane send') printf '%s\\n' 'Paste text into this pane or a pane you opened, then press Enter once the agent is idle. --no-submit only pastes. --stdin reads the text from standard input. Put -- before text that starts with a dash.' ;;
    'pane read') printf '%s\\n' 'Print the last --lines lines (default 200, at most 2000) of a pane. --envelope prints the last worker envelope instead.' ;;
    'pane wait') printf '%s\\n' 'Block until the pane is idle, needs you or has exited. turn waits for any of the three, the end of a turn one way or another. Exits 124 after --timeout seconds (default 600, at most 3600).' ;;
    'pane close') printf '%s\\n' 'Close a pane you opened. A pane whose agent is working needs --force.' ;;
    'skill orchestrate') printf '%s\\n' 'Print the guide for coordinating several workers from this pane.' ;;
  esac
}

help_command() {
  printf 'usage: deck %s\\n\\n' "$(usage_line "$1")"
  printf '%s\\n' "$(describe "$1")"
  printf '\\n%s\\n' 'Add --json for one JSON object instead of text.'
}

help_group() {
  printf '%s\\n' 'usage:'
  case $1 in
    worktree) printf '  deck %s\\n' "$(usage_line 'worktree create')" ;;
    pane) for verb in list open send read wait close; do printf '  deck %s\\n' "$(usage_line "pane $verb")"; done ;;
    skill) printf '  deck %s\\n' "$(usage_line 'skill orchestrate')" ;;
  esac
}

help_main() {
  printf '%s\\n' 'usage: deck [--json] <command> [options]'
  printf '\\n%s\\n' 'Control SpaceVibe Deck from inside one of its panes. Output is short text;'
  printf '%s\\n' '--json prints one JSON object instead.'
  printf '\\n%s\\n' 'commands:'
  for key in 'status' 'worktree create' 'pane list' 'pane open' 'pane send' 'pane read' 'pane wait' 'pane close' 'skill orchestrate'; do
    printf '  deck %s\\n' "$(usage_line "$key")"
  done
  printf '\\n%s\\n' 'Exit codes: 0 done, 1 refused or failed, 2 usage, 3 outside a Deck pane, 124 timed out.'
  printf '%s\\n' 'Run "deck <command> --help" for one command.'
}

# The words before any flag name the command whose help was asked for.
show_help() {
  w1=
  w2=
  for a in "$@"; do
    case $a in
      --) break ;;
      -*) ;;
      *) if [ -z "$w1" ]; then w1=$a; elif [ -z "$w2" ]; then w2=$a; fi ;;
    esac
  done
  case $w1 in
    status) help_command status ;;
    worktree) case $w2 in create) help_command 'worktree create' ;; *) help_group worktree ;; esac ;;
    pane) case $w2 in list|open|send|read|wait|close) help_command "pane $w2" ;; *) help_group pane ;; esac ;;
    skill) case $w2 in orchestrate) help_command 'skill orchestrate' ;; *) help_group skill ;; esac ;;
    *) help_main ;;
  esac
}

# usage_err <message> [<command>]: exit 2 with the command's usage line.
usage_err() {
  printf 'deck: %s\\n' "$1" >&2
  if [ -n "$2" ]; then
    printf 'usage: deck %s\\n' "$(usage_line "$2")" >&2
  else
    printf '%s\\n' 'usage: deck [--json] <command> [options]  (deck --help lists the commands)' >&2
  fi
  exit 2
}

# need_value <command> <flag> [<value> ...]: the flag must be followed by a value.
need_value() {
  [ $# -ge 3 ] || usage_err "$2 needs a value" "$1"
}

valid_id() {
  case $1 in
    '' | 0* | *[!0-9]*) usage_err "<id> must be a pane number, got '$1'" "$2" ;;
  esac
}

absolute() {
  case $1 in
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "$PWD" "$1" ;;
  esac
}

outside_pane() {
  printf '%s\\n' 'deck: run this inside a SpaceVibe Deck pane (a Codex daemon subcommand or opencode with Signals off strips the pane identity)' >&2
  exit 3
}

# --help works anywhere, up to a bare -- that ends the options.
for arg in "$@"; do
  case $arg in
    --) break ;;
    --help | -h) show_help "$@"; exit 0 ;;
  esac
done

case \${DECK_HOOK_PORT-} in '' | *[!0-9]*) outside_pane ;; esac
[ -n "\${DECK_PANE_ID-}" ] && [ -n "\${DECK_HOOK_TOKEN-}" ] || outside_pane

body_file=$(mktemp "\${TMPDIR:-/tmp}/deck-cli.XXXXXX") || { printf '%s\\n' 'deck: cannot create a temporary file' >&2; exit 1; }
trap 'rm -f "$body_file"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

# The tty of the agent process that runs this command (the wrapper's pid when there is one):
# Deck accepts a request only from the terminal of the pane whose token it carries.
tty=$(ps -o tty= -p "\${DECK_AGENT_PID:-$PPID}" 2>/dev/null | tr -d '[:space:]')

json=0

# post <route> [curl args ...]: one POST. Leaves the HTTP status in $code, curl's exit status in
# $curl_status and the reply in $body_file.
post() {
  route=$1
  shift
  if [ "$json" = 1 ]; then set -- "$@" --data-urlencode 'json=1'; fi
  code=$(curl -q -s -S --noproxy '*' -m "$CURL_TIMEOUT" -o "$body_file" -w '%{http_code}' -X POST \\
    -H "X-Deck-Pane: $DECK_PANE_ID" \\
    -H "X-Deck-Token: $DECK_HOOK_TOKEN" \\
    -H "X-Deck-Tty: $tty" \\
    "$@" "http://127.0.0.1:$DECK_HOOK_PORT/control/v1/$route")
  curl_status=$?
}

# settle: act on the last reply. Returns only for 202 ("ask again"); every other outcome exits.
settle() {
  if [ "$curl_status" -ne 0 ]; then
    if [ "$curl_status" -eq 28 ]; then
      printf 'deck: Deck did not answer within %s seconds\\n' "$CURL_TIMEOUT" >&2
      exit 124
    fi
    printf 'deck: Deck is not answering on port %s\\n' "$DECK_HOOK_PORT" >&2
    exit 1
  fi
  case $code in
    202) return 0 ;;
    200) cat "$body_file"; exit 0 ;;
  esac
  if [ "$json" = 1 ]; then cat "$body_file"; else cat "$body_file" >&2; fi
  case $code in
    400) exit 2 ;;
    408 | 504) exit 124 ;;
    *) exit 1 ;;
  esac
}

# run <route> [curl args ...]: a command that never waits.
run() {
  post "$@"
  settle
  printf '%s\\n' 'deck: Deck asked to retry a command that cannot wait' >&2
  exit 1
}

cmd_status() {
  while [ $# -gt 0 ]; do
    case $1 in
      --json) json=1; shift ;;
      *) usage_err "unexpected argument $1" status ;;
    esac
  done
  run status
}

cmd_worktree_create() {
  repo=
  branch=
  dest=
  while [ $# -gt 0 ]; do
    case $1 in
      --json) json=1; shift ;;
      --repo) need_value 'worktree create' "$@"; repo=$2; shift 2 ;;
      --branch) need_value 'worktree create' "$@"; branch=$2; shift 2 ;;
      --dest) need_value 'worktree create' "$@"; dest=$2; shift 2 ;;
      *) usage_err "unexpected argument $1" 'worktree create' ;;
    esac
  done
  [ -n "$repo" ] || usage_err '--repo is required' 'worktree create'
  [ -n "$branch" ] || usage_err '--branch is required' 'worktree create'
  set -- --data-urlencode "repo=$(absolute "$repo")" --data-urlencode "branch=$branch"
  if [ -n "$dest" ]; then set -- "$@" --data-urlencode "dest=$(absolute "$dest")"; fi
  run worktree/create "$@"
}

cmd_pane_list() {
  while [ $# -gt 0 ]; do
    case $1 in
      --json) json=1; shift ;;
      *) usage_err "unexpected argument $1" 'pane list' ;;
    esac
  done
  run pane/list
}

cmd_pane_open() {
  cwd=
  agent=
  prompt=
  has_prompt=0
  name=
  has_name=0
  while [ $# -gt 0 ]; do
    case $1 in
      --json) json=1; shift ;;
      --cwd) need_value 'pane open' "$@"; cwd=$2; shift 2 ;;
      --agent) need_value 'pane open' "$@"; agent=$2; shift 2 ;;
      --prompt) need_value 'pane open' "$@"; prompt=$2; has_prompt=1; shift 2 ;;
      --name) need_value 'pane open' "$@"; name=$2; has_name=1; shift 2 ;;
      *) usage_err "unexpected argument $1" 'pane open' ;;
    esac
  done
  [ -n "$cwd" ] || usage_err '--cwd is required' 'pane open'
  [ -n "$agent" ] || usage_err '--agent is required' 'pane open'
  set -- --data-urlencode "cwd=$(absolute "$cwd")" --data-urlencode "agent=$agent"
  if [ "$has_prompt" = 1 ]; then set -- "$@" --data-urlencode "prompt=$prompt"; fi
  if [ "$has_name" = 1 ]; then set -- "$@" --data-urlencode "name=$name"; fi
  run pane/open "$@"
}

# send_positional <word>: the first word is the pane id, the second the text.
send_positional() {
  if [ -z "$id" ]; then
    id=$1
  elif [ "$has_text" = 0 ]; then
    text=$1
    has_text=1
  else
    usage_err "unexpected argument $1" 'pane send'
  fi
}

cmd_pane_send() {
  id=
  text=
  has_text=0
  no_submit=0
  use_stdin=0
  past_options=0
  while [ $# -gt 0 ]; do
    if [ "$past_options" = 1 ]; then send_positional "$1"; shift; continue; fi
    case $1 in
      --json) json=1; shift ;;
      --no-submit) no_submit=1; shift ;;
      --stdin) use_stdin=1; shift ;;
      --) past_options=1; shift ;;
      -*) usage_err "unknown option $1" 'pane send' ;;
      *) send_positional "$1"; shift ;;
    esac
  done
  valid_id "$id" 'pane send'
  if [ "$use_stdin" = 1 ] && [ "$has_text" = 1 ]; then usage_err 'give the text or --stdin, not both' 'pane send'; fi
  if [ "$use_stdin" = 0 ] && [ -z "$text" ]; then usage_err 'the text is required (or --stdin)' 'pane send'; fi
  set -- --data-urlencode "id=$id"
  if [ "$no_submit" = 1 ]; then set -- "$@" --data-urlencode 'no_submit=1'; fi
  if [ "$use_stdin" = 1 ]; then set -- "$@" --data-urlencode 'text@-'; else set -- "$@" --data-urlencode "text=$text"; fi
  run pane/send "$@"
}

cmd_pane_read() {
  id=
  lines=
  envelope=0
  while [ $# -gt 0 ]; do
    case $1 in
      --json) json=1; shift ;;
      --lines) need_value 'pane read' "$@"; lines=$2; shift 2 ;;
      --envelope) envelope=1; shift ;;
      -*) usage_err "unknown option $1" 'pane read' ;;
      *) if [ -z "$id" ]; then id=$1; shift; else usage_err "unexpected argument $1" 'pane read'; fi ;;
    esac
  done
  valid_id "$id" 'pane read'
  case $lines in *[!0-9]* | 0*) usage_err '--lines must be a positive number' 'pane read' ;; esac
  set -- --data-urlencode "id=$id"
  if [ -n "$lines" ]; then set -- "$@" --data-urlencode "lines=$lines"; fi
  if [ "$envelope" = 1 ]; then set -- "$@" --data-urlencode 'envelope=1'; fi
  run pane/read "$@"
}

cmd_pane_wait() {
  id=
  want=
  timeout=$DEFAULT_WAIT
  while [ $# -gt 0 ]; do
    case $1 in
      --json) json=1; shift ;;
      --for) need_value 'pane wait' "$@"; want=$2; shift 2 ;;
      --timeout) need_value 'pane wait' "$@"; timeout=$2; shift 2 ;;
      -*) usage_err "unknown option $1" 'pane wait' ;;
      *) if [ -z "$id" ]; then id=$1; shift; else usage_err "unexpected argument $1" 'pane wait'; fi ;;
    esac
  done
  valid_id "$id" 'pane wait'
  case $want in idle | needs-you | exited | turn) ;; *) usage_err '--for must be idle, needs-you, exited or turn' 'pane wait' ;; esac
  case $timeout in '' | 0* | *[!0-9]*) usage_err "--timeout must be a number of seconds from 1 to $MAX_WAIT" 'pane wait' ;; esac
  [ "$timeout" -le "$MAX_WAIT" ] || usage_err "--timeout must be a number of seconds from 1 to $MAX_WAIT" 'pane wait'
  # Whole seconds, so the deadline may come up to a second early; the first ask is never skipped.
  deadline=$(($(date +%s) + timeout))
  remaining=$timeout
  while :; do
    post pane/wait --data-urlencode "id=$id" --data-urlencode "for=$want" --data-urlencode "timeout=$remaining"
    settle
    remaining=$((deadline - $(date +%s)))
    if [ "$remaining" -lt 1 ]; then
      printf 'deck: timed out after %s seconds waiting for pane %s\\n' "$timeout" "$id" >&2
      exit 124
    fi
  done
}

cmd_pane_close() {
  id=
  force=0
  while [ $# -gt 0 ]; do
    case $1 in
      --json) json=1; shift ;;
      --force) force=1; shift ;;
      -*) usage_err "unknown option $1" 'pane close' ;;
      *) if [ -z "$id" ]; then id=$1; shift; else usage_err "unexpected argument $1" 'pane close'; fi ;;
    esac
  done
  valid_id "$id" 'pane close'
  set -- --data-urlencode "id=$id"
  if [ "$force" = 1 ]; then set -- "$@" --data-urlencode 'force=1'; fi
  run pane/close "$@"
}

cmd_skill_orchestrate() {
  while [ $# -gt 0 ]; do
    case $1 in
      --json) json=1; shift ;;
      *) usage_err "unexpected argument $1" 'skill orchestrate' ;;
    esac
  done
  run skill/orchestrate
}

while [ $# -gt 0 ]; do
  case $1 in
    --json) json=1; shift ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || usage_err 'a command is required'
group=$1
shift
case $group in
  status) cmd_status "$@" ;;
  worktree | pane | skill)
    verb=\${1-}
    [ $# -gt 0 ] && shift
    case "$group $verb" in
      'worktree create') cmd_worktree_create "$@" ;;
      'pane list') cmd_pane_list "$@" ;;
      'pane open') cmd_pane_open "$@" ;;
      'pane send') cmd_pane_send "$@" ;;
      'pane read') cmd_pane_read "$@" ;;
      'pane wait') cmd_pane_wait "$@" ;;
      'pane close') cmd_pane_close "$@" ;;
      'skill orchestrate') cmd_skill_orchestrate "$@" ;;
      *) usage_err "unknown command '$group $verb'" ;;
    esac ;;
  *) usage_err "unknown command '$group'" ;;
esac
`;
}
