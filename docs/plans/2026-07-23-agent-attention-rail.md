# Agent Attention Rail v1

**Nguồn**: [xterm core capability review](../review/xterm-core-capability-review-2026-07-18.md), [PRD](../PRD.md), [product intent ADR 0011](../decisions/0011-product-intent-parallel-multi-agent.md)
**Goal**: Bổ sung một hàng đợi chú ý đáng tin cậy theo từng pane bên cạnh contract `agentBusy + unread` hiện tại: biết agent đang làm việc, đã hoàn tất, phát cảnh báo/lỗi, hoặc chủ động gọi người dùng; có thể nhảy thẳng tới pane cần xử lý và nhận native notification khi Stackgrid ở background.
**Architecture**: Giữ Stackgrid là local control plane quanh agent CLI, không trở thành agent runtime hay IDE. Raw PTY output, OSC 9;4, OSC 9/777, bell, process poll và pane focus được chuẩn hóa vào một `AgentAttentionTracker` thuần TypeScript. Tracker giữ state theo pane, aggregate thành summary theo tab cho UI, và phát transition có cấu trúc cho lớp native notification. Không parse câu chữ đang hiển thị trong terminal và không tự sửa config của Claude Code, Codex hay Gemini CLI.

## 1. Kết quả mong đợi

- Mỗi workspace/tab cho biết trạng thái quan trọng nhất theo thứ tự `error > warning > requested > completed > working > unread > idle`, đồng thời hiện số pane đang cần chú ý.
- `OSC 9;4` giữ nguyên khả năng nhận biết `working`, nhưng state `2` và `4` không còn bị gộp thành một boolean; chúng lần lượt thành `error` và `warning`.
- Một agent chuyển từ `working` sang `idle` tạo attention `completed`; OSC notification hoặc bell tạo attention `requested`.
- Output thường trong pane chưa xem chỉ tạo `unread`, không bị nâng thành “agent cần chú ý”.
- Focus đúng pane mới acknowledge **attention/per-pane unread mới** của pane đó. Contract legacy vẫn giữ nguyên: output ở background tab bật `TabView.unread`, và public `selectTab()` xóa legacy unread của tab như hiện tại.
- Click status mark của một workspace, hoặc dùng `Cmd+Shift+A`, đưa focus tới pane có attention cao nhất; nhấn tiếp xử lý pane kế tiếp vì pane vừa focus đã được acknowledge.
- Native notification chỉ được bật sau thao tác rõ ràng trong Settings, chỉ gửi khi cửa sổ Stackgrid không focus, mỗi transition gửi tối đa một lần, và không đưa raw terminal text vào title/body.
- Nếu agent/protocol không cung cấp tín hiệu semantic, Stackgrid hạ cấp về `working/idle/unread`; không tự nhận là `needs approval`, `needs input` hay `done` dựa trên text heuristic.
- `npm run build`, `npm test`, và `cargo test --manifest-path src-tauri/Cargo.toml` đều pass trên trạng thái cuối.

## 2. Nguồn dữ liệu chuẩn

**Canonical data**: `AgentAttentionTracker` giữ một `PaneAttentionSnapshot` in-memory cho mỗi pane đang sống.

Shape định hướng:

```ts
type AgentPhase = "unknown" | "idle" | "working" | "exited";
type AttentionKind =
  | "none"
  | "completed"
  | "requested"
  | "warning"
  | "error";
type AttentionSource =
  | "osc-progress"
  | "osc-notification"
  | "bell"
  | "output-heuristic"
  | "process";

interface PaneAttentionSnapshot {
  phase: AgentPhase;
  attention: AttentionKind;
  source: AttentionSource | null;
  confidence: "explicit" | "inferred";
  agentLabel: string | null;
  unread: boolean;
  changedAt: number;
}
```

**Lấy từ**:

- `pty:output`: feed **toàn bộ ordered OSC 9;4 events** trong mỗi batch và sustained-output fallback hiện có, nhưng tracker chỉ nhận activity sau khi `pty_info` đã xác nhận foreground process là agent.
- `PaneEvents`: semantic OSC 9/777 và terminal bell đã được xterm parse đúng ranh giới escape sequence.
- `pty_info`: foreground process quyết định pane đã từng/chưa từng là agent và reset stale state khi process đổi.
- Pane focus + window focus: quyết định người dùng đã thật sự nhìn pane hay chưa.

**KHÔNG lấy từ**:

- Text render trong terminal, regex kiểu “Allow?”, “Press Enter”, “Done”, hay output của model.
- Lựa chọn agent trên Open board như bằng chứng runtime lâu dài; đó vẫn chỉ là launch intent.
- `settings.json` hoặc disk history cho attention state; v1 là state sống theo PTY.
- Cấu hình hook/plugin toàn cục của agent CLI.

## 3. Luật nghiệp vụ và invariants

- **Phase và attention là hai trục khác nhau**: một pane có thể đang `working` nhưng vẫn giữ warning chưa acknowledge; UI dùng attention trước phase.
- **Tín hiệu rõ thắng heuristic**: OSC 9;4/OSC notification/bell thắng sustained-output fallback; fallback không được sinh `warning`, `error`, hay `requested`.
- **Không làm mất transition trong batch**: parser phải trả mọi OSC 9;4 event theo thứ tự. Một PTY chunk `working → error → clear` vẫn phải latch error và ghi nhận phase cuối là idle; không được chỉ giữ sequence cuối.
- **Không nói quá độ chắc chắn**: v1 dùng nhãn chung `requested`/“Needs attention”; không phân biệt `needs input` với `needs approval` nếu chưa có adapter có cấu trúc.
- **Completion phải có working trước đó**: OSC clear `0` khi chưa từng working chỉ là `idle`, không tạo “Done”. Fallback chỉ tạo `completed` sau một working streak thật, không từ một repaint đơn lẻ.
- **Warning/error được latch**: OSC 9;4 clear kết thúc phase working nhưng không tự xóa attention warning/error; focus pane mới acknowledge.
- **Completion không được stale trên một work cycle mới**: nếu pane chuyển lại `working` trước khi người dùng acknowledge, `completed` cũ tự clear; `requested/warning/error` vẫn latch.
- **Per-pane unread mới không thay legacy unread**: tracker đánh dấu output là đã xem chỉ khi cửa sổ focus, tab đang active và DOM focus thật sự nằm trong pane đó. `TabView.unread` và tab-level unread set hiện tại vẫn hoạt động, vẫn xóa khi public `selectTab()` chạy.
- **Acknowledge không xóa phase**: focus pane xóa `attention` và `unread`, nhưng agent đang working vẫn tiếp tục hiện working.
- **Process đổi phải reset tín hiệu cũ theo thứ tự xác định**: agent→shell đóng phase/gate và xóa OSC/fallback evidence cũ. Ngay trước reset, nếu agent đã thật sự `working` và chưa có actionable attention cao hơn thì tạo đúng một `completed` inferred; warning/error/requested đã latch được giữ nguyên và không bị completion hạ cấp. Agent→agent khác reset generation cùng signal-derived state, không suy completion; per-pane unread vẫn theo visibility riêng. Mọi output sau khi gate đóng thuộc shell và bị bỏ qua.
- **Mọi agent activity đều phải qua process gate**: OSC 9;4, sustained-output fallback, OSC notification và bell khi process là shell hoặc chưa có first poll đều bị tracker bỏ qua. Sau khi process được nhận diện bằng allowlist agent, activity/signal mới có quyền tạo attention; agent→shell đóng gate và reset stale state. `AgentActivity` vẫn giữ contract legacy độc lập, nhưng tracker không được replay activity đã xảy ra trước khi gate mở.
- **Không notify app đang foreground**: in-app rail là kênh chính; native notification chỉ hỗ trợ lúc người dùng đang ở app khác.
- **Notification không chứa nội dung terminal**: chỉ dùng workspace label, agent/process label đã chuẩn hóa, và kind như “finished”, “needs attention”, “warning”, “error”.
- **Mỗi transition chỉ notify một lần**: output tiếp theo, poll tiếp theo, hoặc re-render không được gửi lại cùng một revision.
- **Quyền notification là opt-in**: default `false`; chỉ gọi system permission prompt khi người dùng bật trong Settings. Bị từ chối thì setting giữ `false`.
- **Điều hướng có thứ tự ổn định**: `error > warning > requested > completed`, sau đó `changedAt` cũ trước; unread đơn thuần không nằm trong `Cmd+Shift+A`.
- **Điều hướng không focus pane trung gian**: public `selectTab()` giữ nguyên behavior. Đường focus-attention dùng activation nội bộ không focus active pane cũ trước khi focus candidate, nên một action chỉ acknowledge đúng một pane.
- **Điều hướng chỉ chạy khi terminal có thể nhìn thấy**: click status và shortcut dùng cùng một preflight. Không có candidate là no-op hoàn toàn; Open board/Settings có thể được đóng bằng đường không focus, còn `PresetEditor`/`SavePresetDialog` đang giữ draft thì action bị chặn và không tự đóng.
- **Pane ID vẫn là PTY ID**: tracker, focus và prune đều dùng invariant hiện có; đóng/respawn pane phải xóa record cũ.

## 4. Phạm vi

**Làm trong v1**:

- Sửa baseline typecheck đang đỏ trong test, không đổi production behavior.
- State model và reducer attention theo pane.
- Nâng `AgentActivity` để bảo toàn OSC severity/source thay vì chỉ trả boolean.
- Bắt OSC 9/777 notification và bell qua xterm public API.
- Per-pane unread, acknowledge, tab aggregation và focus-next-attention.
- Status mark nhất quán ở workspace sidebar và horizontal tab bar.
- Native notification qua Tauri notification plugin, permission opt-in trong Settings.
- ADR, glossary, architecture, flow, requirements, UX và README tương ứng.

**Ngoài phạm vi**:

- Agent-specific adapters/hooks cho Claude Code, Codex, Gemini CLI.
- Phân biệt `needs_input`, `needs_approval`, `review_ready` bằng semantic event riêng.
- Parse terminal text hoặc model output.
- Run history/ledger, token/cost telemetry, transcript, replay.
- Team Run Recipes, role per pane, task graph, orchestration.
- Git worktree lanes, branch/conflict map.
- Session restore hoặc persistence của attention state.
- Thay đổi Open board agent allowlist/detection.
- Marketing, version bump, packaging, release/notarization.

## 5. Quyết định đã chốt, rủi ro và điểm mở

### Quyết định đã chốt

- **Đợt đầu là Attention Rail, không phải orchestration**: đây là khoảng trống gần nhất với job-to-be-done “watch and steer agents in parallel” và tận dụng trực tiếp data plane hiện có.
- **Trạng thái semantic vừa đủ**: `completed/requested/warning/error`; không quảng cáo độ chi tiết mà protocol chưa chứng minh.
- **Protocol-first, adapter-ready**: v1 đọc chuẩn terminal chung. `AttentionSource` và `confidence` là seam cho adapter agent-specific sau này, nhưng chưa cài hay sửa agent config.
- **Existing sidebar chính là rail**: không tạo một panel/inbox mới. Workspace row aggregate state; status mark đưa người dùng thẳng tới pane.
- **Per-pane acknowledge là lớp additive**: attention/per-pane unread mới dùng pane focus; tab-level legacy unread clearing và `TabView.agentBusy/unread` được giữ nguyên để không breaking behavior/callers.
- **Native notification opt-in và background-only**: giảm spam, tránh permission prompt lúc startup, giữ in-app rail là nguồn chính.
- **Không lưu lịch sử ở v1**: attention phục vụ điều phối hiện tại, không biến thành audit system.

### Rủi ro đã biết

- **Fallback có thể kết luận completion hơi sớm**: sustained output chỉ là inference. Giảm thiểu bằng `confidence: inferred`, yêu cầu đã có working transition, và không dùng fallback để suy ra approval/input.
- **Bell có thể đến từ TUI không liên quan đến agent**: chỉ nhận khi pane đã được nhận diện là agent; process change reset stale signal.
- **OSC 9;4 warning/error có thể vừa là progress severity vừa là terminal decoration**: latch cho tới focus là có chủ đích; không persist qua pane lifecycle.
- **Permission bị revoke ngoài app**: notifier kiểm tra permission trước send và fail silent; Settings không tự bật lại.
- **Race giữa output và process poll**: `AgentActivity` vẫn có thể lưu raw progress cho contract legacy, nhưng tracker bỏ qua mọi transition trước first recognized-agent poll và không replay chúng khi gate mở. Không dùng board choice để giả lập runtime truth.
- **Same-name process restart không phải identity mới đáng tin cậy**: `pty_info` hiện chỉ có process label, không PID/generation. V1 reset theo label transition và PTY lifecycle; nếu agent restart cùng basename mà poll bỏ lỡ shell ở giữa, tracker có thể không nhận ra generation mới. Không thêm PID trong scope này.
- **Build baseline đang đỏ**: lỗi nằm ở typings của test doubles và ES2020 test syntax. Task 1-2 khôi phục gate trước khi đụng production code.

### Compatibility guardrails bắt buộc

- `TabView.agentBusy` và `TabView.unread` không bị xóa/đổi type/đổi semantics trong v1; `attention` là optional additive field.
- Legacy tab unread set, background-tab detection và public `selectTab()` clearing giữ nguyên regression tests.
- `PaneEvents`, `PaneLifecycle` deps và `ManagerCallbacks` chỉ nhận optional callbacks; existing callers/test doubles vẫn compile.
- Tham số thứ ba của `createTabManager(host, pty, deps)` vẫn là một object phẳng tương thích `TerminalManagerDeps`; `TabManagerDeps extends TerminalManagerDeps` chỉ thêm optional seams, nên `{ createPane }` hiện tại tiếp tục compile.
- `TerminalManager.show()` vẫn focus như trước; non-focusing behavior chỉ qua optional argument ở private attention path.
- `WorkspaceLogo.pending/unread`, process dot, row/tab click, close và popover behavior giữ nguyên khi không có actionable attention.
- Click status và `Cmd+Shift+A` không được tự đóng `PresetEditor`/`SavePresetDialog`, không làm mất draft, không focus terminal sau overlay, và không đóng Open board/Settings khi không có attention candidate.
- Persisted settings cũ không có `agentNotifications` validate thành `false`; không migration destructive.
- Close/busy guard, Open board, agent launch, preset/session behavior, process killing và PTY ownership không nằm trong production diff.
- Mỗi task đổi contract additive phải chạy `npm run build` ngay trong task, không để codebase đỏ chờ task sau.

### Quyết định còn mở

Không có quyết định sản phẩm nào chặn implementation. Hai điểm sau được cố ý dời sang phase sau:

- Có nên ship agent-specific adapter để tách `needs input` và `needs approval`.
- Có nên persist một run ledger sau khi Attention Rail có dữ liệu sử dụng thực tế.

## 6. Các task

### Task 0: Chụp baseline worktree trước khi sửa

**File(s)**: Không sửa file trong task này.

**Decision**: Baseline của người dùng là dữ liệu phải bảo toàn, không phải noise cần làm sạch. Implementation không revert, stage, commit hoặc format unrelated files.

**Build**:

- Chạy `git status --porcelain=v1 -z`, `git diff --binary` và `git diff --cached --binary` trước mọi edit.
- Tạo temp dir bằng `STACKGRID_BASELINE_DIR=$(mktemp -d)`, lưu ba output vào đó và ghi lại exact path trong execution log.
- Lưu thêm `git ls-files --others --exclude-standard -z`; với từng untracked path, tạo manifest NUL-safe chứa path, loại entry, lstat mode và SHA-256 của regular-file bytes hoặc exact symlink target. Không chỉ lưu tên file.
- Tách danh sách file đã dirty/untracked trước execution khỏi allowlist file mà plan dự kiến chạm.

**Verify**:

- Baseline snapshot tồn tại ngoài worktree và đọc lại được.
- Mọi file dirty/untracked có trước được ghi nhận; manifest đủ để so byte-for-byte cả untracked files/symlinks và không có lệnh reset/checkout/clean/stage nào chạy.

---

### Task 1: Khôi phục typecheck cho fake `Pane`

**File(s)**:

- [pane-lifecycle.test.ts](../../src/terminal/pane-lifecycle.test.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Decision**: Bổ sung no-op `captureSelection` và `restoreSelection` vào test doubles; không nới `Pane` interface và không sửa production code.

**Build**:

- `captureSelection()` trả `null`.
- `restoreSelection()` là no-op.
- Giữ các fake methods còn lại và assertions hiện có.

**Verify**:

- `npm run build` không còn lỗi `TS2322`/`TS2739` ở hai file này; lỗi còn lại nếu có chỉ nằm ở `search-bar.test.ts` trước Task 2.

---

### Task 2: Khôi phục typecheck cho search tests dưới ES2020

**File(s)**:

- [search-bar.test.ts](../../src/terminal/search-bar.test.ts)

**Decision**: Sửa typing của callback trên `any[][]` theo element type thực và thay `.at(-1)` bằng index ES2020; không nâng `tsconfig` target chỉ để phục vụ test.

**Build**:

- Bỏ tuple annotation `[string]` không đúng với `any[]`.
- Thay `.at(-1)` bằng truy cập `array[array.length - 1]`.

**Verify**:

- `npm run build` pass trước khi bắt đầu task production.
- `npm test -- search-bar` pass.

---

### Task 3: Ghi quyết định và domain language của Attention Rail

**File(s)**:

- [0027-agent-attention-signals-and-ack.md](../decisions/0027-agent-attention-signals-and-ack.md) (mới)
- [CONTEXT.md](../../CONTEXT.md)

**Decision**: ADR 0027 có `affects: [PRD, BUSINESS-FLOW, ARCHITECTURE, UX-DESIGN, REQUIREMENTS]`; thêm glossary cho `Agent phase`, `Attention`, `Unread`, `Acknowledge`, tránh dùng lẫn `Busy`.

**Build**:

- ADR ghi source precedence, per-pane ack, notification policy và out-of-scope adapters/history.
- `Busy` tiếp tục là foreground-process guard cho close flow; `Agent phase` mới là runtime work signal. Hai khái niệm không thay thế nhau.

**Verify**:

- `rg -n "Agent phase|Attention|Acknowledge" CONTEXT.md docs/decisions/0027-agent-attention-signals-and-ack.md` trả đủ định nghĩa.
- ADR có frontmatter hợp lệ, id không trùng và không sửa ADR cũ.

---

### Task 3A: Giữ toàn bộ ordered OSC 9;4 events qua PTY batching

**File(s)**:

- [osc-progress.ts](../../src/lib/osc-progress.ts)
- [osc-progress.test.ts](../../src/lib/osc-progress.test.ts)

**Decision**: Thêm incremental parser trả mọi progress event theo thứ tự và chỉ giữ **incomplete trailing sequence** làm carry. Giữ nguyên exports `lastProgressState(text)` và `OSC_CARRY_LENGTH` như compatibility surface cho callers/tests cũ. State được giữ dưới dạng raw non-negative integer; chỉ `0..4` có semantic mapping biết trước.

**Build**:

- API mới nhận `carry + chunk`, trả `{ events, carry }`; mỗi event giữ raw numeric state và optional progress.
- Sequence hoàn chỉnh không được parse lại ở chunk sau; carry có hard cap và chỉ bắt đầu từ một OSC 9;4 prefix chưa có BEL/ST terminator.
- `lastProgressState` dùng parser mới nhưng vẫn trả `number | null` và giữ semantics “event cuối thắng”.

**Verify**:

- `npm test -- osc-progress` pass.
- Test giữ toàn bộ event cho `working→error→clear` và `warning→clear` trong cùng chunk.
- Test state `2`, `4` và unknown non-zero như `7` đều được parse, giữ nguyên raw value; `lastProgressState(...)` vẫn trả `7`, parser không silently drop future protocol states.
- Test sequence split ở mọi ranh giới quan trọng: sau ESC, sau `]9;4;`, giữa state/progress, giữa ESC và `\\` terminator.
- Test chunk kế tiếp không emit lại một completed sequence đã nằm ở cuối chunk trước.

---

### Task 4: Nâng `AgentActivity` từ boolean lên typed snapshot

**File(s)**:

- [agent-activity.ts](../../src/terminal/agent-activity.ts)
- [agent-activity.test.ts](../../src/terminal/agent-activity.test.ts)

**Phụ thuộc**: Task 3A

**Decision**: Giữ nguyên API/return type của `noteOutput(id, chunk)` và `working(id)` cho callers hiện tại. Thêm additive `noteOutputEvents(id, chunk)` và `snapshot(id)` để consumer mới nhận ordered transitions với `phase`, `source`, `severity`; map OSC `0=idle`, `1/3=working`, `2=error`, `4=warning`, còn unknown non-zero vẫn là `working` với `severity: null`.

**Build**:

- `noteOutput` dùng cùng implementation nhưng vẫn chỉ trả boolean working-state flip như trước; không caller cũ nào phải đổi.
- `noteOutputEvents` áp từng progress event từ Task 3A và trả ordered activity transitions, kể cả khi final phase quay về idle trong cùng chunk. Transition có `observedAt`; fallback còn có `evidenceStartedAt` để process gate không nhận một streak đã bắt đầu trước khi gate mở.
- Record giữ raw OSC numeric state cùng derived phase/severity; không thu hẹp thành union làm mất future states.
- Compatibility rule giữ nguyên chính xác: `working(id)` là `oscState !== 0` cho mọi non-zero state, gồm `2`, `4` và unknown như `7`.
- Fallback chỉ trả `working/idle` với source `output-heuristic`.
- `noteProcess` reset snapshot khi process thật sự đổi như behavior hiện tại.

**Verify**:

- `npm test -- agent-activity` pass.
- Test cũ của `noteOutput`/`working` giữ nguyên; test mới chứng minh state `2` khác `4`, `working(2)`, `working(4)` và `working(7)` đều là `true`, `snapshot` giữ raw `7` nhưng không tự gán severity, `working→error→clear` cùng chunk không mất error, OSC thắng fallback, và pane chưa có signal trả `unknown`.

---

### Task 5: Tạo pure per-pane attention tracker

**File(s)**:

- [agent-attention.ts](../../src/terminal/agent-attention.ts) (mới)
- [agent-attention.test.ts](../../src/terminal/agent-attention.test.ts) (mới)

**Phụ thuộc**: Task 4

**Decision**: Tracker sở hữu phase, latched attention, unread, `changedAt`, revision, last process label và PTY lifecycle generation. Không gọi process label là identity; same-name restart bị giới hạn như mục rủi ro. Mọi method trả transition hoặc `null` để caller biết khi nào cần sync/notify.

**Build**:

- Input tối thiểu: `noteActivity`, `noteSignal`, `noteOutputVisibility`, `noteProcess`, `noteExit`, `acknowledge`, `snapshot`, `summarize`, `actionable`, `prune`.
- `noteProcess` nhận process label + recognized-agent boolean từ allowlist hiện có, ghi gate-open timestamp/revision và giữ last recognized agent label cho copy sau completion. Cả `noteActivity` và `noteSignal` bỏ qua input khi state là pre-poll unknown hoặc shell.
- Agent→shell xử lý atomically theo thứ tự: nếu prior gated phase là working và không có requested/warning/error thì emit/latch một inferred completion (không duplicate explicit completion đã có), sau đó đóng gate, đưa phase về idle và reset activity evidence; latched higher-severity attention không bị completion ghi đè. Agent→agent khác reset generation/evidence/signal-derived attention, mở gate mới và không suy completion; per-pane unread không bị process reset.
- Mở gate không replay progress/fallback đã xảy ra trước poll; chỉ transition mới sau recognized-agent poll được phép đổi phase/attention.
- Explicit OSC dùng `observedAt >= gateOpenedAt`; fallback còn yêu cầu `evidenceStartedAt >= gateOpenedAt`, nên một output streak bắt đầu ở shell/pre-poll không thể “đi nhờ” phần đuôi sau poll để tạo working/completed.
- Warning/error/requested/completed latch cho tới acknowledge.
- `summarize` áp precedence toàn tab; `actionable` sort severity rồi `changedAt`.

**Verify**:

- `npm test -- agent-attention` pass.
- Test bao phủ working→idle completion, clear không có working, working mới clear completion cũ, warning/error latch, focus ack không xóa working, process-label reset, PTY exit/prune, same-name limitation không bị mô tả sai, per-pane unread, severity ordering và stable oldest-first.
- Agent gate tests: shell OSC 9;4 warning/error và sustained output bị bỏ qua; pre-poll activity/signal bị bỏ qua và không replay sau poll; fallback streak vắt qua gate vẫn bị bỏ qua; recognized agent activity/signal mới được nhận; working agent→shell tạo tối đa một inferred completion trước reset; idle agent→shell không tạo completion; existing warning/error/requested không bị hạ cấp; mọi activity/signal sau khi gate đóng bị bỏ qua.

---

### Task 6: Phân loại OSC notification mà không parse terminal text

**File(s)**:

- [osc-notification.ts](../../src/lib/osc-notification.ts) (mới)
- [osc-notification.test.ts](../../src/lib/osc-notification.test.ts) (mới)

**Decision**: Pure classifier nhận OSC id + payload đã được xterm tách; OSC 9;4 trả `null` vì progress đi đường riêng, OSC 9 notification và OSC 777 `notify` trả signal `requested`. Payload chỉ dùng để xác nhận protocol, không đưa nội dung vào UI/OS notification.

**Build**:

- Chấp nhận OSC 9 general notification và OSC 777 notify form.
- Reject empty/malformed payload và OSC 9;4.
- Không giữ title/body raw trong result.

**Verify**:

- `npm test -- osc-notification` pass với OSC 9, OSC 777, OSC 9;4, payload rỗng và malformed.

---

### Task 7: Đưa OSC notification và bell ra khỏi `Pane`

**File(s)**:

- [pane.ts](../../src/terminal/pane.ts)
- [pane-lifecycle.ts](../../src/terminal/pane-lifecycle.ts)
- [pane-lifecycle.test.ts](../../src/terminal/pane-lifecycle.test.ts)

**Phụ thuộc**: Task 6

**Decision**: Mở rộng `PaneEvents` và `PaneLifecycle` deps bằng optional `onAttentionSignal?(id, signal)` để mọi caller/test double hiện tại vẫn compile. `term.parser.registerOscHandler(9/777)` và `term.onBell` chỉ emit signal có cấu trúc, không gửi native notification tại lớp xterm.

**Build**:

- Đăng ký/dispose OSC handlers và bell disposable cùng lifecycle của pane.
- `PaneLifecycle` forward signal qua optional dependency callback giống `onFocus`; thiếu callback là no-op.
- Fake panes/tests chứng minh signal giữ đúng pane id.

**Verify**:

- `npm test -- pane-lifecycle osc-notification` pass.
- `npm run build` pass.

---

### Task 7A: Route attention signal qua `TerminalManager`

**File(s)**:

- [terminal-manager.ts](../../src/terminal/terminal-manager.ts)
- [terminal-manager.test.ts](../../src/terminal/terminal-manager.test.ts) (mới)

**Phụ thuộc**: Task 7

**Decision**: Thêm optional `ManagerCallbacks.onAttentionSignal?(id, signal)`. Đường truyền duy nhất là `PaneEvents → PaneLifecycle deps → ManagerCallbacks → TabManager`; thiếu callback giữ behavior hiện tại.

**Build**:

- `createTerminalManager` truyền callback từ lifecycle lên `ManagerCallbacks` bằng optional chaining.
- Không xử lý state hoặc notification tại TerminalManager.
- Test fake pane phát OSC/bell signal qua `PaneEvents` và assert callback nhận đúng pane id/payload, signal của manager khác không bị lẫn.

**Verify**:

- `npm test -- terminal-manager pane-lifecycle` pass.
- `npm run build` pass với caller `createTerminalManager` hiện tại chưa cung cấp callback mới.

---

### Task 8: Thêm primitive focus-pane và callback focus lên `TabManager`

**File(s)**:

- [terminal-manager.ts](../../src/terminal/terminal-manager.ts)
- [terminal-manager.test.ts](../../src/terminal/terminal-manager.test.ts) (mới)

**Phụ thuộc**: Task 7A

**Decision**: `TerminalManager` public `focusPane(id): boolean`; `ManagerCallbacks` thêm optional `onPaneFocus?(id)`. Unknown/dead id là no-op và trả `false`; caller hiện tại không truyền callback vẫn giữ nguyên behavior/build.

**Build**:

- Route qua `setActive` rồi `pane.focus()` để giữ zoom restore, focus-expand và active classes.
- Callback optional chỉ emit khi pane thật sự thuộc manager.
- `focusActive`, click/focusin và programmatic focus đều đi qua cùng ack path, không recursive loop.

**Verify**:

- `npm test -- terminal-manager` pass với focus known/unknown, active id update, zoom restore và callback đúng một pane.
- `npm run build` pass ngay sau thay đổi contract; không chờ Task 11 mới sửa compile.

---

### Task 9: Bổ sung attention summary vào `TabView`

**File(s)**:

- [tabs-store.ts](../../src/terminal/tabs-store.ts)
- [tabs-store.test.ts](../../src/terminal/tabs-store.test.ts)

**Phụ thuộc**: Task 5

**Decision**: Migration additive: giữ nguyên required fields `agentBusy` và `unread` cùng semantics hiện tại; thêm optional `attention?: AgentAttentionSummary` gồm `kind`, `actionableCount`, `workingCount`, `unreadCount`. Existing constructors/callers không phải đổi ngay.

**Build**:

- Export type summary dùng chung cho UI.
- Tạo constant/helper idle summary để consumer mới fallback khi `attention === undefined`.
- `agentBusy` tiếp tục dùng computation hiện tại (`isAgent && activity.working`); không reimplement qua summary trong v1.
- `unread` tiếp tục đến từ legacy tab-level set và clear trong public `selectTab()` như hiện tại.
- `applyTabOverride` chỉ merge name/dot color như cũ.

**Verify**:

- `npm test -- tabs-store` pass.
- Toàn bộ fixtures cũ chỉ có `agentBusy/unread` vẫn compile/pass.
- Test xác nhận override không đổi workspace, `agentBusy`, legacy `unread` hoặc attention summary.

---

### Task 10: Wire tracker vào output, process, exit và prune

**File(s)**:

- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Phụ thuộc**: Task 4, Task 5, Task 7A, Task 9

**Decision**: `TabManager` là owner duy nhất của tracker. `syncViews` reconcile process/activity rồi aggregate; output handler trước hết quyết định visibility theo active tab/focused pane; exit và layout change prune record. Window-focus gate được nối riêng ở Task 11.

**Build**:

- Giữ nguyên tab-level `unread` set và public `selectTab()` clearing để bảo toàn legacy behavior; tracker có per-pane unread riêng.
- Feed raw output bằng additive `noteOutputEvents`, sau đó feed **từng ordered transition** vào tracker; không chỉ feed final snapshot.
- Reconcile `noteProcess` từ poll trước khi nhận activity của cycle đó; feed structured pane signal, process poll và `pty:exit`.
- Cung cấp `ManagerCallbacks.onAttentionSignal`; tracker chỉ accept **cả activity lẫn signal** khi last polled process thỏa `isAgent`. Unknown/shell là no-op và transition trước poll không được replay sau poll.
- Ở bước này, chỉ pane thuộc active tab và là focused pane mới không bị unread; Task 11 bổ sung điều kiện cửa sổ phải foreground.
- Giữ one-shot resync timer để working heuristic có thể chuyển idle/completed trong im lặng.

**Verify**:

- `npm test -- tab-manager` pass.
- Regression case cũ vẫn pass: active tab không bật legacy unread, background tab output bật legacy unread, public `selectTab()` xóa legacy unread.
- Case mới: hai pane cùng tab giữ tracker unread độc lập; public `selectTab()` không acknowledge attention của pane chưa focus; `working→error→clear` cùng batch vẫn aggregate error; exit/prune không để badge ma.
- Gate cases: shell OSC 9;4 warning/error, shell sustained output, shell OSC notification/bell và unknown trước first poll không tạo phase/actionable attention. Working agent→shell chỉ được tạo một inferred completion theo Task 5 rồi đóng gate; activity/signal shell sau transition không tạo thêm attention. Legacy `agentBusy` tests vẫn giữ semantics cũ.

---

### Task 11: Acknowledge theo pane và theo window focus

**File(s)**:

- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Phụ thuộc**: Task 8, Task 10

**Decision**: Khởi tạo window-focus state bằng `await getCurrentWindow().isFocused()` **trước khi đăng ký PTY output listeners**, rồi theo dõi `onFocusChanged`. Default/failure state là `focused=true` để fail-safe theo hướng không spam native notification. Pane chỉ acknowledge khi DOM focus của nó xảy ra trong cửa sổ foreground.

**Build**:

- `ManagerCallbacks.onPaneFocus` gọi tracker acknowledge có gate window focus và pane ownership.
- `init()` lấy initial focus state, sau đó đăng ký/unlisten window focus listener trong `init/dispose`, rồi mới nhận output.
- `isFocused` hoặc listener registration reject: log warning, giữ focused=true, feature in-app vẫn hoạt động nhưng native notification bị suppress.
- Visibility predicate dùng `paneElement(id).contains(document.activeElement)` thay vì chỉ dựa vào `activePaneId`.
- Test mock cung cấp `isFocused` + `onFocusChanged` và phát focus state chủ động.

**Verify**:

- `npm test -- tab-manager` pass với initial true, initial false, `isFocused` reject, listener registration reject, background-window output, foreground return khi terminal focus, foreground return khi Settings-like element còn focus, tab có nhiều pane và dispose listener.

---

### Task 11A: Thêm non-focusing show path nhưng giữ default behavior

**File(s)**:

- [terminal-manager.ts](../../src/terminal/terminal-manager.ts)
- [terminal-manager.test.ts](../../src/terminal/terminal-manager.test.ts) (mới)

**Phụ thuộc**: Task 8

**Decision**: Mở rộng additive `show(options?: { focus?: boolean })`; `show()` mặc định `focus: true` và giữ behavior hiện tại. Chỉ internal attention navigation dùng `show({ focus: false })`.

**Build**:

- Dù `focus: false`, manager vẫn display + fit mọi pane như hiện tại.
- Chỉ bỏ bước `activePane.focus()` cuối hàm; không đổi active id, layout hoặc zoom.

**Verify**:

- `npm test -- terminal-manager` pass.
- Test `show()` vẫn focus active pane đúng một lần; `show({ focus: false })` không focus pane nào nhưng container hiển thị và panes vẫn fit.
- `npm run build` pass với mọi caller cũ tiếp tục gọi `show()` không options.

---

### Task 11B: Kích hoạt target tab atomically cho attention navigation

**File(s)**:

- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Phụ thuộc**: Task 11, Task 11A

**Decision**: Giữ public `selectTab(index)` nguyên behavior: hide/show-focus, clear legacy unread, sync. Thêm private path `activateForAttention(index, paneId)` làm hide → set active → clear legacy unread → `show({ focus:false })` → `focusPane(paneId)`; không focus active pane cũ.

**Build**:

- Same-tab target chỉ gọi `focusPane(candidate)`.
- Cross-tab target không gọi public `selectTab()` rồi focus lần hai.
- Validate candidate còn thuộc target manager **trước** khi hide/đổi active tab. Unknown/dead candidate là no-op hoàn toàn, không đổi tab và không acknowledge pane khác; activation + focus sau validation là một đoạn synchronous không có `await`.

**Verify**:

- `npm test -- tab-manager` pass.
- Regression: public `selectTab()` vẫn focus active pane và clear legacy unread như trước.
- Atomic test: target tab có attention ở active pane cũ và một pane khác priority cao hơn; một action chỉ acknowledge candidate, attention ở active pane cũ còn nguyên.
- Test target chết giữa selection/focus không xóa attention của pane khác.

---

### Task 12: Thêm command focus attention tiếp theo

**File(s)**:

- [keymap.ts](../../src/terminal/keymap.ts)
- [keymap.test.ts](../../src/terminal/keymap.test.ts)
- [tab-manager.ts](../../src/terminal/tab-manager.ts)

**Phụ thuộc**: Task 10, Task 11B

**Decision**: `Cmd+Shift+A` là `focus-next-attention`. `TabManager.focusNextAttention(tabIndex?)` chọn candidate từ tracker; optional tab index phục vụ click status mark của một workspace. Shortcut không focus trực tiếp mà gửi request qua optional app-level seam để dùng cùng overlay preflight với status click.

**Build**:

- Đổi type tham số thứ ba thành `TabManagerDeps extends TerminalManagerDeps`, giữ object phẳng và thêm optional `onRequestAttentionFocus?: (tabIndex?: number) => void`; mọi caller `{ createPane }` hiện tại vẫn hợp lệ.
- Thêm `hasActionableAttention(tabIndex?): boolean` để app-level preflight kiểm tra candidate đồng bộ mà không đổi UI khi queue rỗng.
- Global command chọn severity cao nhất rồi oldest-first trên toàn bộ tabs.
- Scoped command chỉ chọn trong tab được click.
- Route qua `activateForAttention`; không gọi public `selectTab()` trên cross-tab path.
- Dispatch `Cmd+Shift+A` chỉ gọi `deps.onRequestAttentionFocus?.()`; thiếu callback là no-op an toàn, không bypass overlay. App nối production callback ở Task 15.
- Không candidate là no-op hoàn toàn, không đóng overlay và không hijack unread-only panes.

**Verify**:

- `npm test -- keymap tab-manager` pass.
- Test global/scoped ordering, unknown tab, no candidate, atomic cross-tab focus và nhấn liên tiếp chuyển qua hai pane.
- Regression compile/test với third arg omitted và `{ createPane }`; shortcut có callback chỉ route request đúng một lần, thiếu callback không focus trực tiếp.

---

### Task 13: Tạo status mark dùng chung

**File(s)**:

- [agent-attention-mark.tsx](../../src/ui/agent-attention-mark.tsx) (mới)
- [agent-attention-mark.test.tsx](../../src/ui/agent-attention-mark.test.tsx) (mới)
- [styles.css](../../src/styles.css)

**Phụ thuộc**: Task 9

**Decision**: Một component render spinner cho working, dot cho unread, badge + count cho actionable state; color/label theo precedence và có accessible name đầy đủ.

**Build**:

- Error dùng red, warning dùng yellow, requested dùng accent/magenta, completed dùng green, unread dùng yellow hiện có.
- Actionable mark là button; working/unread mark chỉ là status decoration.
- Tôn trọng `prefers-reduced-motion` cho spinner.

**Verify**:

- `npm test -- agent-attention-mark` pass với từng kind, count > 1, click và accessible label.
- Không hardcode màu ngoài semantic CSS vars hiện có.

---

### Task 14: Gắn rail vào sidebar và horizontal tab bar

**File(s)**:

- [workspace-logo.tsx](../../src/ui/workspace-logo.tsx)
- [workspace-sidebar.tsx](../../src/ui/workspace-sidebar.tsx)
- [tab-bar.tsx](../../src/ui/tab-bar.tsx)

**Phụ thuộc**: Task 12, Task 13

**Decision**: Migration additive. `WorkspaceLogo` giữ required props `pending/unread` và precedence/render hiện tại khi không có actionable attention; thêm optional attention/action props. `WorkspaceSidebar`/`TabBar` thêm optional `onFocusAttention?` để `App` hiện tại vẫn compile cho tới Task 15. Top tab bar giữ nguyên process identity dot và thêm status mark cạnh label.

**Build**:

- `WorkspaceLogo` tiếp tục nhận `pending/unread`; optional actionable attention chỉ outrank overlay cũ khi `actionableCount > 0`. Không actionable thì spinner/unread DOM/classes giữ nguyên.
- Status mark chỉ là interactive button khi callback tồn tại; thiếu callback render non-interactive status/no-op-safe, không ném lỗi.
- Hai chrome mode có tooltip/aria giống nhau.
- `TabBar` không thay/xóa `tab__dot` hoặc process-derived color.
- Không thay workspace label/path, close button, row/tab selection hay popover semantics.

**Verify**:

- `npm run build` pass.
- Eye check xác nhận badge không che logo/process dot/close action ở count 1 và 2 chữ số.

---

### Task 14A: Khóa regression behavior cho hai chrome mode

**File(s)**:

- [workspace-logo.test.tsx](../../src/ui/workspace-logo.test.tsx) (mới)
- [workspace-sidebar.test.tsx](../../src/ui/workspace-sidebar.test.tsx) (mới)
- [tab-bar.test.tsx](../../src/ui/tab-bar.test.tsx) (mới)

**Phụ thuộc**: Task 14

**Decision**: Test behavior trước khi coi UI migration hoàn tất; không dựa vào “component tests hiện có” vì repo chưa có ba suite này.

**Build**:

- `WorkspaceLogo`: không attention giữ đúng pending-over-unread classes/precedence; actionable attention mới outrank; optional props omitted vẫn render.
- Sidebar: status click chỉ gọi `onFocusAttention` và không select/toggle popover; row click vẫn select hoặc toggle active popover; close chỉ gọi close; label/path/logo còn nguyên.
- Top bar: status click không select/toggle popover; tab click, active popover và close giữ nguyên; `tab__dot` vẫn tồn tại và dùng process/dotColor cũ.
- Render actionable count hai chữ số và assert close/status đều còn accessible/clickable.

**Verify**:

- `npm test -- workspace-logo workspace-sidebar tab-bar` pass.
- `npm run build` pass.

---

### Task 14B: Tạo overlay-safe attention focus coordinator

**File(s)**:

- [attention-focus-coordinator.ts](../../src/ui/attention-focus-coordinator.ts) (mới)
- [attention-focus-coordinator.test.ts](../../src/ui/attention-focus-coordinator.test.ts) (mới)

**Phụ thuộc**: Task 12, Task 14A

**Decision**: Shortcut và status click gọi cùng một synchronous coordinator. Coordinator chỉ dismiss overlay không giữ draft sau khi xác nhận còn candidate; `PresetEditor`/`SavePresetDialog` luôn block action để không mất dữ liệu chưa lưu.

**Build**:

- Input gồm optional tab index, `hasCandidate`, snapshot bốn overlay (`board`, `settings`, `presetEditor`, `savePresetDialog`), hai dismiss action không focus và `focusAttention`.
- Thứ tự preflight cố định: không candidate → no-op; editor/save dialog mở → blocked/no-op và giữ nguyên mọi overlay/draft; còn lại đóng Open board/Settings bằng set-state trực tiếp rồi mới gọi `focusAttention`.
- Không gọi `OpenBoard.onCancel` hoặc `closePanel()` vì hai đường legacy này focus active pane và có thể acknowledge pane trung gian.
- Không có `await` giữa candidate check, overlay dismissal và focus; `focusNextAttention` vẫn revalidate candidate trước activation.

**Verify**:

- `npm test -- attention-focus-coordinator` pass.
- Chạy cùng ma trận cho request global kiểu shortcut và scoped kiểu status: no candidate giữ nguyên UI; board-only, settings-only và board+settings dismiss rồi focus đúng một lần; editor, save dialog và các tổ hợp có draft không dismiss/focus.
- Assert operation order không có focus trước khi terminal visible và không gọi legacy cancel/close handlers.

---

### Task 15: Nối UI action qua `App`

**File(s)**:

- [app.tsx](../../src/ui/app.tsx)

**Phụ thuộc**: Task 14B

**Decision**: `App` tạo đúng một callback `requestAttentionFocus(index?)` qua coordinator. `WorkspaceSidebar`, `TabBar` và `TabManagerDeps.onRequestAttentionFocus` đều dùng callback này, nên status click và `Cmd+Shift+A` có cùng preflight.

**Build**:

- Không thay `onSelectTab`; attention click là action riêng.
- Truyền callback vào `createTabManager` bằng `TabManagerDeps` phẳng; shortcut không tự gọi `focusNextAttention`.
- `hasCandidate` gọi `tabsRef.current?.hasActionableAttention(index)`, overlay snapshot đọc `boardOpen`, `panelOpen`, `editorRequest` và `saveDialogOpen` tại thời điểm request.
- Dismiss board/settings bằng `boardOpen.value = false` và `panelOpen.value = false`; không gọi `closePanel()`/board cancel nên không focus pane trung gian.
- Nếu editor/save dialog mở hoặc không có candidate, giữ nguyên mọi state và không focus.

**Verify**:

- `npm run build` pass.
- Bộ test kết hợp chứng minh wiring: `tab-manager.test.ts` khóa shortcut chỉ route callback, chrome tests Task 14A khóa status click chỉ route callback, và coordinator tests chạy cùng overlay matrix cho global/scoped request; draft editor/save còn nguyên khi action bị block.
- Chạy app ở cả `tabBarPosition=left` và `top`: click badge vào đúng pane khi terminal có thể hiển thị.

---

### Task 16: Thêm setting notification opt-in

**File(s)**:

- [settings-schema.ts](../../src/settings/settings-schema.ts)
- [settings-schema.test.ts](../../src/settings/settings-schema.test.ts)

**Decision**: Field `agentNotifications: boolean`, default `false`; dữ liệu cũ hoặc sai type fallback false.

**Build**:

- Thêm field vào `Settings`, `DEFAULT_SETTINGS`, `validateSettings`.
- Reset defaults tắt notification.

**Verify**:

- `npm test -- settings-schema settings-store` pass với missing, true, false và invalid input.

---

### Task 17: Thêm JavaScript notification package

**File(s)**:

- [package.json](../../package.json)
- [package-lock.json](../../package-lock.json)

**Phụ thuộc**: Task 16

**Decision**: Dùng official `@tauri-apps/plugin-notification` v2, không dùng Web Notification API của WKWebView.

**Build**:

- Chạy `npm install @tauri-apps/plugin-notification@^2`.
- Không thay dependency khác.

**Verify**:

- `npm ls @tauri-apps/plugin-notification` trả đúng một v2 dependency.
- `npm run build` resolve được package.

---

### Task 18: Thêm Rust notification plugin dependency

**File(s)**:

- [Cargo.toml](../../src-tauri/Cargo.toml)
- [Cargo.lock](../../src-tauri/Cargo.lock)

**Decision**: Dùng `tauri-plugin-notification = "2"` cùng major với Tauri app.

**Build**:

- Chạy `cargo add --manifest-path src-tauri/Cargo.toml tauri-plugin-notification@2`.
- Không bật feature ngoài nhu cầu desktop notification.

**Verify**:

- `cargo check --manifest-path src-tauri/Cargo.toml` pass.

---

### Task 19: Đăng ký plugin và capability tối thiểu

**File(s)**:

- [lib.rs](../../src-tauri/src/lib.rs)
- [default.json](../../src-tauri/capabilities/default.json)

**Phụ thuộc**: Task 18

**Decision**: Register `tauri_plugin_notification::init()`; capability chỉ cấp `allow-is-permission-granted`, `allow-request-permission`, `allow-notify`, không dùng `notification:default`.

**Build**:

- Gắn plugin cạnh opener/store/dialog.
- Thêm ba permission cụ thể cho window `main`.

**Verify**:

- `cargo test --manifest-path src-tauri/Cargo.toml` pass.
- `npm run tauri dev` khởi động không có unknown-plugin/unknown-permission error; API permission path được kiểm tra sau khi adapter tồn tại ở Task 20/22.

---

### Task 20: Tạo adapter native notification có test seam

**File(s)**:

- [native-notification.ts](../../src/lib/native-notification.ts) (mới)
- [native-notification.test.ts](../../src/lib/native-notification.test.ts) (mới)

**Phụ thuộc**: Task 17, Task 19

**Decision**: Wrapper mỏng quanh `isPermissionGranted`, `requestPermission`, `sendNotification`; expose memory/fake seam cho unit test. Request permission và send là hai hành vi tách biệt.

**Build**:

- `requestAgentNotificationPermission()` trả boolean, không tự đổi settings.
- `sendAgentNotification(payload)` re-check permission; denied hoặc permission API reject là no-op có kiểm soát. Official `sendNotification` trả `void`, nên wrapper chỉ guard lỗi synchronous và không giả vờ có delivery receipt.
- Payload type không có field raw terminal body.

**Verify**:

- `npm test -- native-notification` pass với already-granted, grant, deny, revoke và API reject.

---

### Task 21: Tạo notification policy theo transition

**File(s)**:

- [agent-notifier.ts](../../src/terminal/agent-notifier.ts) (mới)
- [agent-notifier.test.ts](../../src/terminal/agent-notifier.test.ts) (mới)

**Phụ thuộc**: Task 5, Task 20

**Decision**: Notifier là policy thuần/injectable: chỉ actionable transition, setting true, window background, revision chưa gửi; copy chỉ gồm workspace label + agent label + normalized kind.

**Build**:

- Dedupe key theo pane id + revision.
- Prune key khi pane chết.
- `completed/requested/warning/error` có copy cố định; không notify `working/unread`.

**Verify**:

- `npm test -- agent-notifier` pass với foreground, disabled, duplicate revision, next revision, prune và privacy assertion không chứa raw OSC payload.

---

### Task 21A: Thêm disabled state additive cho `ToggleRow`

**File(s)**:

- [config-row.tsx](../../src/ui/controls/config-row.tsx)
- [config-row.test.tsx](../../src/ui/controls/config-row.test.tsx) (mới)

**Decision**: Thêm optional `disabled?: boolean` vào `ToggleRow`; default false giữ toàn bộ callers/behavior hiện tại. Native `button.disabled` là enforcement, không chỉ CSS.

**Build**:

- Forward `disabled` vào button; thêm disabled class chỉ để style, không thay role/switch/aria-checked.
- Không đổi `ConfigRow` contract.

**Verify**:

- `npm test -- config-row` pass: omitted/false vẫn click và toggle như cũ; true không gọi `onToggle`, có native disabled state.
- `npm run build` pass với mọi ToggleRow caller cũ.

---

### Task 22: Thêm permission toggle vào Settings

**File(s)**:

- [settings-panel.tsx](../../src/ui/settings-panel.tsx)
- [settings-panel.test.tsx](../../src/ui/settings-panel.test.tsx)

**Phụ thuộc**: Task 16, Task 20, Task 21A

**Decision**: `ToggleRow` “Agent notifications” trong behavior. Bật gọi permission request từ click; chỉ update true khi granted. Tắt update false ngay.

**Build**:

- Disable/re-entry guard trong lúc system prompt đang mở.
- Truyền `disabled={requesting}` vào `ToggleRow`; local guard vẫn chặn re-entry trước khi signal render lại.
- Denied/rejected giữ false và báo lỗi ngắn qua error surface hiện có.
- Không request permission lúc mount/startup/reset.

**Verify**:

- `npm test -- settings-panel` pass với enable-granted, enable-denied, permission API reject, disable, double-click/re-entry chỉ request một lần và không-request-on-render.
- Manual: system permission prompt chỉ xuất hiện sau click.

---

### Task 23: Wire notifier vào `TabManager`

**File(s)**:

- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Phụ thuộc**: Task 10, Task 11, Task 21

**Decision**: Mọi attention transition từ tracker đi qua một choke point `maybeNotify`; label lấy từ workspace/tab/process metadata đã có, không từ output. Mở rộng `TabManagerDeps` đã tạo ở Task 12 bằng optional notifier seam, không thay shape tham số thứ ba.

**Build**:

- Thêm `notifier?: AgentNotifier` vào `TabManagerDeps extends TerminalManagerDeps`; existing third arg `{ createPane }` tiếp tục compile.
- Production default là `createAgentNotifier(...)` với `isEnabled: () => settings.value.agentNotifications` và native adapter Task 20; injected notifier thắng default trong test.
- Existing tests không inject notifier vẫn an toàn vì setting mặc định `false`; tests transition phải inject fake hoặc mock native client rõ ràng, không gọi Tauri API ngầm.
- Gọi notifier sau state reconcile, không trong per-byte render loop nếu không có transition.
- Prune/dispose notifier cùng tracker.

**Verify**:

- `npm test -- tab-manager agent-notifier` pass.
- Contract tests: third arg omitted, `{ createPane }`, và `{ createPane, notifier }` đều compile/hoạt động; production-default path đọc setting hiện tại thay vì capture startup value.
- Integration cases: background completion gửi một lần; foreground không gửi; warning ưu tiên đúng; output thường không gửi.

---

### Task 24: Render product/flow/requirements từ ADR 0027

**File(s)**:

- [PRD.md](../PRD.md)
- [BUSINESS-FLOW.md](../BUSINESS-FLOW.md)
- [REQUIREMENTS.md](../REQUIREMENTS.md)

**Phụ thuộc**: Task 3

**Decision**: Ghi Attention Rail là current scope sau v1 baseline; requirements tách phase, attention, ack, navigation và notification permission thành acceptance criteria kiểm thử được.

**Build**:

- PRD thêm observe/attention outcome, không thêm orchestration.
- BUSINESS-FLOW thêm transitions signal → attention → acknowledge.
- REQUIREMENTS thêm FR/AC mới và trace về ADR 0027.

**Verify**:

- Mỗi requirement mới có ít nhất một acceptance criterion và source trace.
- Docs phân biệt rõ: opening/selecting tab vẫn clear legacy tab unread; chỉ pane focus mới acknowledge new attention/per-pane unread. Không ghi đè behavior cũ bằng câu tổng quát.

---

### Task 25: Cập nhật architecture, UX và README

**File(s)**:

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [UX-DESIGN.md](../UX-DESIGN.md)
- [README.md](../../README.md)

**Phụ thuộc**: Task 13, Task 19, Task 24

**Decision**: Architecture ghi state pipeline và Tauri notification boundary; UX ghi precedence/click/keyboard/accessibility; README mô tả chính xác feature đã ship, không dùng “approval/input” quá mức dữ liệu.

**Build**:

- Giữ mô tả spinner/legacy unread đúng behavior hiện tại, rồi bổ sung attention summary + per-pane ack như lớp mới.
- Thêm `Cmd+Shift+A` vào shortcut docs.
- Ghi notification opt-in/background-only.

**Verify**:

- `rg -n "Cmd\\+Shift\\+A|Agent Attention|notification" README.md docs/ARCHITECTURE.md docs/UX-DESIGN.md` trả đủ mục.
- Docs không nói attention persist qua restart hay Stackgrid parse model output.

---

### Task 25A: Thêm deterministic runtime fixture cho process gate

**File(s)**:

- [agent-attention-fixture.zsh](../../scripts/agent-attention-fixture.zsh) (mới, dev-only)

**Phụ thuộc**: Task 10

**Decision**: Acceptance runtime dùng một foreground `/bin/zsh` fixture có kernel `argv[0] = claude`, không phụ thuộc behavior/version/network của agent thật. Không dùng Python làm process wrapper vì macOS framework launcher có thể re-exec và rewrite `argv[0]`. Fixture chỉ phục vụ dev verification, không import hoặc package vào production app.

**Build**:

- Script dùng `/bin/zsh` + builtins/system tools có sẵn trên macOS, chờ hơn một poll interval trước event đầu, emit raw OSC 9;4/OSC 9/OSC 777/bell theo scenario và giữ interpreter/group leader sống đủ lâu để poll nhận diện.
- Chạy như một foreground job từ pane ở repo root bằng `/bin/zsh -c 'exec -a claude /bin/zsh scripts/agent-attention-fixture.zsh all'`. Interactive shell tạo foreground process group cho outer zsh; `exec -a` thay nó bằng interpreter có kernel argv0 `claude`, và script không tail-exec Python/Node hay process khác.
- Có scenario riêng cho multi-event cùng batch và split terminator; không dùng text output làm expected semantic signal.
- Có scenario `probe` không emit attention signal, chỉ giữ process sống để xác minh chính data path `pty_info`, không suy từ board choice hay tên file.

**Verify**:

- `/bin/zsh -n scripts/agent-attention-fixture.zsh` pass.
- Probe ngoài app trong PTY interactive xác nhận `PID == PGID == TPGID` và `ps -ww` cho `comm/args` bắt đầu bằng `claude`, nên fixture đúng là foreground group leader và không bị interpreter rewrite; acceptance trong app vẫn phải chạy scenario `probe` và assert chính `pty_info.process === "claude"` qua pane header/test seam trước khi chạy event scenarios.
- Nếu `pty_info` không trả `claude`, runtime test dừng thay vì nhận kết quả false-negative; không đổi allowlist production chỉ để fixture pass.
- Chạy agent thật chỉ là optional smoke, không phải acceptance fixture.

---

### Task 26: Xác minh tự động toàn bộ

**File(s)**: Không sửa file trong task này.

**Phụ thuộc**: Task 0-25A, gồm toàn bộ task có hậu tố A/B

**Decision**: Không chấp nhận “unit tests xanh” nếu typecheck hoặc Rust gate còn đỏ.

**Verify**:

- `npm run build` pass.
- `npm test` pass.
- `cargo test --manifest-path src-tauri/Cargo.toml` pass.
- `git diff --check` pass.
- So `git status --porcelain=v1 -z`, unstaged diff, staged diff, NUL-delimited untracked list và regenerated SHA-256/symlink manifest với snapshot Task 0. Mọi **delta do implementation tạo** phải nằm trong allowlist `File(s)` của plan.
- File dirty/untracked có từ baseline nhưng ngoài plan phải còn nguyên byte/diff/target; nếu có concurrent external change thì dừng và báo, không revert hay nhận vơ.
- Không stage/commit bất kỳ file nào trong verification task.

---

### Task 27: Xác minh runtime và accessibility

**File(s)**: Không sửa file trong task này.

**Phụ thuộc**: Task 26

**Decision**: Runtime acceptance dùng deterministic foreground fixture Task 25A; agent thật chỉ là smoke bổ sung. Không sửa global config của agent.

**Verify**:

- Chạy `npm run tauri dev`, mở preset ít nhất 2 pane và một workspace background.
- Trong một pane ở repo root, chạy scenario `probe` bằng launcher `/bin/zsh` ghi ở Task 25A và xác nhận chính `pty_info`/pane header là `claude`; sau đó chạy các scenario `all`, multi-event cùng batch và split terminator bằng cùng launcher.

- Quan sát working/clear/warning/error/requested đúng precedence và không có badge ma sau acknowledge.
- Focus từng pane: chỉ pane đó được acknowledge.
- `Cmd+Shift+A`: lần lượt tới error, warning, requested, completed; unread-only bị bỏ qua.
- Đổi tab bar `left` ↔ `top`: cùng state/click behavior.
- Regression cả hai mode: click row/tab vẫn select/toggle popover, close vẫn chỉ close, process dot giữ màu cũ, legacy background-tab unread vẫn bật và clear khi public tab selection mở tab.
- Cross-tab attention: target tab có active pane cũ và candidate khác; một lần click/shortcut chỉ candidate được acknowledge.
- Overlay regression: queue rỗng không đóng overlay; Open board/Settings có candidate thì shortcut/status dismiss không focus trung gian rồi tới đúng pane; PresetEditor/SavePresetDialog có draft thì cả hai nguồn request đều no-op và draft còn nguyên.
- Bật notification: permission prompt chỉ xuất hiện sau click; chuyển sang app khác rồi emit completion/requested, mỗi transition có đúng một native notification và copy không chứa terminal text.
- Tắt notification: cùng transitions vẫn hiện trong rail nhưng không có native notification.
- Dùng keyboard-only và VoiceOver/Accessibility Inspector: status button có tên chứa workspace, kind và count; focus ring nhìn thấy; spinner tôn trọng reduced motion.
