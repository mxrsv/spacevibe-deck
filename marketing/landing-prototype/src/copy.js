export const messages = {
  en: {
    navProduct: "Deck",
    navGithub: "GitHub",
    heroLabel: "// native macOS terminal for agent CLIs",
    headlineLead: "Run the grid.",
    headlineTail: "Keep every agent in sight.",
    subhead:
      "SpaceVibe Deck is a native macOS terminal built to launch, watch, and steer AI coding agents in parallel.",
    primaryCta: "Watch the 45-sec demo",
    secondaryCta: "View on GitHub",
    localeLabel: "Language",
    tourKicker: "// from folder to full formation",
    tourCh1Title: "Start from a known formation.",
    tourCh1Body:
      "The Open board remembers each project's layout preset and agent. Reopening your whole team is one keystroke.",
    tourCh2Title: "Give every pane an agent.",
    tourCh2Body:
      "Pick an agent once — Deck launches it into every pane, chrome tinted per agent so you can read the room at a glance.",
    tourCh3Title: "See the system. Work the detail.",
    tourCh3Body:
      "Focus Expand (⌘E) grows the active pane to 65% while every other agent stays in sight.",
    finaleLabel: "// what you keep",
    finaleTitle: "Your shell, intact.",
    proofPtyTitle: "Real PTY, real shell",
    proofPtyBody:
      "Every pane runs your login shell ($SHELL -l) — PATH, aliases, and dotfiles just work.",
    proofLocalTitle: "Local-first, no telemetry",
    proofLocalBody:
      "Everything stays on your machine — no accounts, no tracking, no network beyond what your agents do.",
    proofNativeTitle: "Native Tauri 2, no Electron",
    proofNativeBody: "A lightweight native shell that stays out of your way.",
    scSplit: "split",
    scSplitH: "split down",
    scTab: "new tab",
    scExpand: "focus expand",
    scFind: "find",
    scClear: "clear",
    finaleDownload: "Download for macOS",
    footerTagline:
      "A native macOS terminal for running AI agent CLIs side by side.",
    footerColProduct: "Product",
    footerColProject: "Project",
    footerReleases: "Releases",
    footerIssues: "Issues",
    footerLicense: "MIT License",
    footerBuilt: "Built with Tauri 2 · xterm.js · Preact",
  },
  vi: {
    navProduct: "Deck",
    navGithub: "GitHub",
    heroLabel: "// terminal macOS native cho agent CLI",
    headlineLead: "Vận hành cả đội hình.",
    headlineTail: "Không agent nào rời khỏi tầm mắt.",
    subhead:
      "SpaceVibe Deck là terminal macOS native để khởi chạy, quan sát và điều phối nhiều AI coding agent song song.",
    primaryCta: "Xem demo 45 giây",
    secondaryCta: "Xem trên GitHub",
    localeLabel: "Ngôn ngữ",
    tourKicker: "// từ thư mục đến cả đội hình",
    tourCh1Title: "Bắt đầu từ đội hình quen thuộc.",
    tourCh1Body:
      "Open board nhớ sẵn layout preset và agent của từng dự án — mở lại cả đội chỉ mất một phím.",
    tourCh2Title: "Giao mỗi pane một agent.",
    tourCh2Body:
      "Chọn agent một lần — Deck khởi chạy vào mọi pane, viền màu theo từng agent để nhìn một cái là biết ai đang làm gì.",
    tourCh3Title: "Nhìn toàn cảnh. Làm chi tiết.",
    tourCh3Body:
      "Focus Expand (⌘E) nới pane đang focus lên 65%, các agent còn lại vẫn trong tầm mắt.",
    finaleLabel: "// những thứ bạn giữ nguyên",
    finaleTitle: "Shell của bạn, nguyên vẹn.",
    proofPtyTitle: "PTY thật, shell thật",
    proofPtyBody:
      "Mỗi pane chạy đúng login shell của bạn ($SHELL -l) — PATH, alias, dotfiles hoạt động y nguyên.",
    proofLocalTitle: "Local-first, không telemetry",
    proofLocalBody:
      "Mọi thứ nằm trên máy bạn — không tài khoản, không theo dõi, không kết nối nào ngoài của chính agent.",
    proofNativeTitle: "Tauri 2 native, không Electron",
    proofNativeBody: "Vỏ native gọn nhẹ, không choán tài nguyên máy.",
    scSplit: "chia dọc",
    scSplitH: "chia ngang",
    scTab: "tab mới",
    scExpand: "focus expand",
    scFind: "tìm kiếm",
    scClear: "xoá buffer",
    finaleDownload: "Tải cho macOS",
    footerTagline:
      "Terminal macOS native để chạy song song nhiều AI agent CLI.",
    footerColProduct: "Sản phẩm",
    footerColProject: "Dự án",
    footerReleases: "Bản phát hành",
    footerIssues: "Báo lỗi",
    footerLicense: "Giấy phép MIT",
    footerBuilt: "Xây bằng Tauri 2 · xterm.js · Preact",
  },
};

export function resolveLocale(search, navigatorLanguage) {
  const override = new URLSearchParams(search).get("lang");

  if (override === "en" || override === "vi") {
    return override;
  }

  return navigatorLanguage.toLowerCase().startsWith("vi") ? "vi" : "en";
}
