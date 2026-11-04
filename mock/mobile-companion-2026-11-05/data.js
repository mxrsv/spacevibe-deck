/* Mock data for the iPhone direction mock. Real project names from the owner's workspace,
   real notifier copy ("<agent> needs attention" / "finished" / "error"), plausible values.
   buildData(true) swaps in worst-case strings and counts. */
window.buildData = function buildData(worst) {
  const W = (normal, extreme) => (worst ? extreme : normal);
  const agents = {
    claude: { name: "Claude Code", logo: "assets/agent-claude.svg", mono: false },
    codex: { name: "Codex", logo: "assets/agent-codex.svg", mono: true },
    opencode: { name: "opencode", logo: "assets/agent-opencode.svg", mono: true },
  };
  const deck = W("spacevibe-deck", "spacevibe-academy-content-pipeline-experiments");
  const api = W("spacevibe-api", "spacevibe-api-relay-and-leaderboard-registry");
  const academy = "spacevibe-academy";
  const relay = W(
    "worktree-mobile-relay",
    "claude/1287-migrate-the-session-journal-to-sqlite-without-losing-state",
  );
  const desktop = W("MacBook Pro", "Kyan’s MacBook Pro (Office, 16-inch, 2024)");

  const panes = [
    {
      id: "p1",
      agent: "claude",
      project: deck,
      checkout: "main",
      st: "needs",
      line: "Wants to run npm test -- electron/relay/",
      when: "now",
    },
    {
      id: "p2",
      agent: "codex",
      project: api,
      checkout: "main",
      st: "needs",
      line: "Asks which route the relay should use",
      when: "2m",
    },
    {
      id: "p3",
      agent: "opencode",
      project: api,
      checkout: "main",
      st: "failed",
      line: "Exited 1 after 4 failing tests",
      when: "6m",
    },
    {
      id: "p4",
      agent: "codex",
      project: deck,
      checkout: relay,
      st: "working",
      line: W("Running tests · 1m 12s", "Running tests · 3h 41m 12s"),
      when: "8m",
    },
    {
      id: "p5",
      agent: "claude",
      project: deck,
      checkout: relay,
      st: "done",
      line: "Committed 3 files",
      when: "14m",
    },
    {
      id: "p6",
      agent: "claude",
      project: academy,
      checkout: "main",
      st: "done",
      line: "Lesson 4 draft is ready",
      when: "31m",
    },
    {
      id: "p7",
      agent: null,
      shell: "zsh",
      project: deck,
      checkout: "main",
      st: "idle",
      line: "~/spacevibe-deck",
      when: "1h",
    },
  ];
  if (worst) {
    for (let i = 0; i < 7; i++) {
      panes.splice(2, 0, {
        id: "x" + i,
        agent: i % 2 ? "codex" : "claude",
        project: api,
        checkout: "claude/9" + i + "4-a-checkout-name-that-never-ends-in-the-rail",
        st: "needs",
        line: "Do you want to make this edit to src/terminal/agent-attention-tracker-with-a-long-name.ts?",
        when: i + 3 + "m",
      });
    }
  }
  const needsCount = panes.filter((p) => p.st === "needs" || p.st === "failed").length;

  return {
    worst,
    agents,
    desktop,
    desktops: [
      { name: desktop, os: "macOS", online: true, path: W("Relay", "Relay · LAN unavailable") },
      {
        name: W("Studio PC", "Build machine in the back room (Windows 11 Pro)"),
        os: "Windows",
        online: false,
        seen: W("2 h ago", "41 days ago"),
      },
    ],
    projects: [
      { name: deck, needs: 1 },
      { name: api, needs: worst ? 9 : 2 },
      { name: academy, needs: 0 },
      { name: "spacevibe-bench", needs: 0 },
    ],
    deck,
    api,
    relay,
    panes,
    needsCount: worst ? 128 : needsCount,
    question: W(
      "Should the relay answer at /relay/* on the api host, or under /v1/relay/* next to the leaderboard routes?",
      "Before I continue: the relay Worker, the Durable Object migration, the APNs key rotation and the analytics payload bump all touch deploy order. Which of these four do you want first, and should I open a separate worktree for each so their PRs stay reviewable on their own?",
    ),
    changes: [
      { st: "M", name: "client.ts", dir: "electron/relay/", add: W(48, 12480), del: W(6, 9311) },
      { st: "A", name: "pairing.ts", dir: "electron/relay/", add: W(112, 3021), del: 0 },
      { st: "A", name: "pairing.test.ts", dir: "electron/relay/", add: 86, del: 0 },
      { st: "M", name: "release-switches.ts", dir: "src/lib/", add: 1, del: 0 },
      { st: "M", name: "main.ts", dir: "electron/", add: 9, del: 2 },
      {
        st: "M",
        name: W("settings-mobile.tsx", "settings-mobile-section-with-paired-phones-and-revoke.tsx"),
        dir: W("src/settings/", "src/settings/sections/mobile/rows/"),
        add: 64,
        del: 3,
      },
      { st: "D", name: "relay-stub.ts", dir: "electron/", add: 0, del: 31 },
    ],
  };
};

/* Terminal screens, 64 columns. Spans: s strong, mu muted, ac accent, ok green, sel selection. */
window.TERM = {
  claudePrompt: [
    '<span class="s">&gt;</span> Wire the relay client into main behind mobileCompanion',
    "",
    '<span class="ac">⏺</span> I’ll add the relay client and gate it on the switch.',
    "",
    '<span class="ac">⏺</span> <span class="s">Update</span>(electron/relay/client.ts)',
    '  <span class="mu">⎿  Updated electron/relay/client.ts with 48 additions</span>',
    '<span class="ok">      12 +export function startRelay(config: RelayConfig) {</span>',
    '<span class="ok">      13 +  if (!config.enabled) return null;</span>',
    '<span class="ok">      14 +  const socket = openSocket(config.url, config.pairId);</span>',
    '<span class="ok">      15 +  return sealChannel(socket, config.keys);</span>',
    "",
    '<span class="ac">⏺</span> The relay route is wired. Running the checks before I',
    "  commit.",
    "",
    '<span class="ac">⏺</span> <span class="s">Bash</span>(npm test -- electron/relay/)',
    '  <span class="mu">⎿  Running…</span>',
    "",
    "__ASK__╭────────────────────────────────────────────────────────────╮",
    '__ASK__│ <span class="s">Bash command</span>                                               │',
    "__ASK__│                                                            │",
    "__ASK__│   npm test -- electron/relay/                              │",
    '__ASK__│   <span class="mu">Run the relay unit tests</span>                                 │',
    "__ASK__│                                                            │",
    "__ASK__│ Do you want to proceed?                                    │",
    '__ASK__│ <span class="sel">❯ 1. Yes</span>                                                   │',
    "__ASK__│   2. Yes, and don’t ask again for npm test commands in     │",
    "__ASK__│      this project                                          │",
    "__ASK__│   3. No, and tell Claude what to do differently (esc)      │",
    "__ASK__╰────────────────────────────────────────────────────────────╯",
  ],
};
