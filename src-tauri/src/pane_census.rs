//! The busy guard's evidence, computed in Rust (spec §9.4).
//!
//! The frontend used to gather this itself, so a wedged webview meant an
//! unanswerable quit prompt. `info::classify_process` already runs here, so the
//! same classification the pane header shows can be produced without asking any
//! window anything. The mirror on the TypeScript side is
//! `src/terminal/close-guard.ts` — `isBusy`, `busyProcesses` and the
//! `fullyNamed` test in `confirmClose` — and the two must agree.

use crate::info::{PaneProcessKind, PtyInfo};

fn is_busy(info: &PtyInfo) -> bool {
    matches!(info.kind, PaneProcessKind::Agent | PaneProcessKind::Busy)
}

/// True when every pane is explicitly an idle shell — the one case that skips
/// the dialog entirely.
pub fn all_idle(infos: &[PtyInfo]) -> bool {
    infos
        .iter()
        .all(|info| matches!(info.kind, PaneProcessKind::IdleShell))
}

/// Everything one confirm dialog needs, and nothing the frontend has to
/// recompute.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusyCensus {
    pub request_id: u64,
    /// Deduplicated busy process names, in pane order.
    pub busy_processes: Vec<String>,
    /// Panes, not names: three panes running `claude` are one name and three
    /// panes, and the dialog must say three.
    pub busy_panes: usize,
    /// False when any pane could not be classified — the dialog then uses the
    /// generic "could not verify" copy.
    pub fully_named: bool,
}

pub fn census_for(request_id: u64, infos: &[PtyInfo]) -> BusyCensus {
    let mut busy_processes: Vec<String> = Vec::new();
    for info in infos.iter().filter(|info| is_busy(info)) {
        if let Some(process) = info.process.as_deref() {
            if !busy_processes.iter().any(|name| name == process) {
                busy_processes.push(process.to_string());
            }
        }
    }
    let fully_named = infos.iter().all(|info| match info.kind {
        PaneProcessKind::IdleShell => true,
        PaneProcessKind::Agent | PaneProcessKind::Busy => info.process.is_some(),
        PaneProcessKind::Unknown => false,
    });
    BusyCensus {
        request_id,
        busy_processes,
        busy_panes: infos.iter().filter(|info| is_busy(info)).count(),
        fully_named,
    }
}

#[cfg(test)]
mod tests {
    use super::{all_idle, census_for};
    use crate::info::{PaneAgent, PaneProcessKind, PtyInfo};

    fn info(id: u32, kind: PaneProcessKind, process: Option<&str>) -> PtyInfo {
        PtyInfo {
            id,
            cwd: None,
            process: process.map(str::to_string),
            kind,
            agent: match kind {
                PaneProcessKind::Agent => Some(PaneAgent::Claude),
                _ => None,
            },
        }
    }

    #[test]
    fn all_idle_shells_need_no_dialog() {
        let infos = [
            info(1, PaneProcessKind::IdleShell, Some("zsh")),
            info(2, PaneProcessKind::IdleShell, Some("bash")),
        ];
        assert!(all_idle(&infos));
        assert_eq!(census_for(7, &infos).busy_panes, 0);
    }

    #[test]
    fn busy_names_are_deduplicated_but_panes_are_counted() {
        let infos = [
            info(1, PaneProcessKind::Agent, Some("claude")),
            info(2, PaneProcessKind::Agent, Some("claude")),
            info(3, PaneProcessKind::Busy, Some("cargo")),
            info(4, PaneProcessKind::IdleShell, Some("zsh")),
        ];
        let census = census_for(7, &infos);

        assert!(!all_idle(&infos));
        assert_eq!(census.request_id, 7);
        assert_eq!(census.busy_processes, vec!["claude", "cargo"]);
        assert_eq!(census.busy_panes, 3);
        assert!(census.fully_named);
    }

    #[test]
    fn an_unknown_pane_makes_the_census_not_fully_named() {
        let infos = [
            info(1, PaneProcessKind::IdleShell, Some("zsh")),
            info(2, PaneProcessKind::Unknown, None),
        ];
        let census = census_for(7, &infos);

        assert!(!all_idle(&infos));
        assert!(!census.fully_named);
        assert!(census.busy_processes.is_empty());
    }

    #[test]
    fn a_busy_pane_with_no_process_name_is_not_fully_named() {
        let infos = [info(1, PaneProcessKind::Busy, None)];
        let census = census_for(7, &infos);

        assert!(!census.fully_named);
        assert_eq!(census.busy_panes, 1);
    }

    #[test]
    fn census_serializes_camel_case_for_the_dialog() {
        let infos = [info(1, PaneProcessKind::Agent, Some("claude"))];
        assert_eq!(
            serde_json::to_value(census_for(7, &infos)).unwrap(),
            serde_json::json!({
                "requestId": 7,
                "busyProcesses": ["claude"],
                "busyPanes": 1,
                "fullyNamed": true
            })
        );
    }
}
