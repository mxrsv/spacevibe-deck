use super::command_line::split_windows_command_line;
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AgentIdentity {
    Claude,
    Codex,
    Gemini,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProcessKind {
    IdleShell,
    Agent,
    Busy,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProcessClassification {
    pub kind: ProcessKind,
    pub agent: Option<AgentIdentity>,
    pub process: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SessionProcessRoot {
    pub session_id: u32,
    pub process_id: Option<u32>,
    pub creation_date: Option<i64>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct ProcessRecord {
    pub process_id: Option<u32>,
    pub parent_process_id: Option<u32>,
    pub creation_date: Option<i64>,
    pub name: Option<String>,
    pub executable_path: Option<String>,
    pub command_line: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum SnapshotError {
    Query(String),
    Incomplete(String),
}

impl std::fmt::Display for SnapshotError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Query(message) | Self::Incomplete(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for SnapshotError {}

pub(crate) trait ProcessSnapshotProvider {
    fn snapshot(&self) -> Result<Vec<ProcessRecord>, SnapshotError>;
}

#[cfg(target_os = "windows")]
pub(crate) struct WmiProcessSnapshotProvider;

#[cfg(target_os = "windows")]
impl ProcessSnapshotProvider for WmiProcessSnapshotProvider {
    fn snapshot(&self) -> Result<Vec<ProcessRecord>, SnapshotError> {
        use serde::Deserialize;
        use wmi::{WMIConnection, WMIDateTime};

        #[derive(Deserialize)]
        #[serde(rename_all = "PascalCase")]
        struct Win32Process {
            process_id: Option<u32>,
            parent_process_id: Option<u32>,
            creation_date: Option<WMIDateTime>,
            name: Option<String>,
            executable_path: Option<String>,
            command_line: Option<String>,
        }

        const QUERY: &str = "SELECT ProcessId, ParentProcessId, CreationDate, Name, \
                             ExecutablePath, CommandLine FROM Win32_Process";
        let connection =
            WMIConnection::new().map_err(|error| SnapshotError::Query(error.to_string()))?;
        let rows: Vec<Win32Process> = connection
            .raw_query(QUERY)
            .map_err(|error| SnapshotError::Query(error.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|row| ProcessRecord {
                process_id: row.process_id,
                parent_process_id: row.parent_process_id,
                creation_date: row
                    .creation_date
                    .map(|creation_date| creation_date.0.timestamp_micros()),
                name: row.name,
                executable_path: row.executable_path,
                command_line: row.command_line,
            })
            .collect())
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn process_creation_date(process_id: u32) -> Result<i64, SnapshotError> {
    WmiProcessSnapshotProvider
        .snapshot()?
        .into_iter()
        .find(|record| record.process_id == Some(process_id))
        .and_then(|record| record.creation_date)
        .ok_or_else(|| {
            SnapshotError::Incomplete(format!("Process {process_id} has no creation identity"))
        })
}

#[derive(Clone, Debug)]
struct Descendant<'a> {
    record: &'a ProcessRecord,
    process_id: u32,
    creation_date: i64,
    depth: usize,
}

#[derive(Clone, Debug)]
struct AgentCandidate {
    identity: AgentIdentity,
    process: String,
    direct: bool,
    depth: usize,
    creation_date: i64,
    process_id: u32,
}

pub(crate) fn classify_many(
    provider: &impl ProcessSnapshotProvider,
    roots: &[SessionProcessRoot],
) -> Vec<(u32, Result<ProcessClassification, SnapshotError>)> {
    let snapshot = provider.snapshot();
    roots
        .iter()
        .map(|root| {
            (
                root.session_id,
                snapshot
                    .as_ref()
                    .map_err(Clone::clone)
                    .and_then(|rows| classify_root(rows, *root)),
            )
        })
        .collect()
}

fn classify_root(
    records: &[ProcessRecord],
    root: SessionProcessRoot,
) -> Result<ProcessClassification, SnapshotError> {
    let root_pid = root
        .process_id
        .ok_or_else(|| SnapshotError::Incomplete("The shell process id is unavailable".into()))?;
    let root_creation = root.creation_date.ok_or_else(|| {
        SnapshotError::Incomplete("The shell creation date is unavailable".into())
    })?;
    let root_record = records
        .iter()
        .find(|record| record.process_id == Some(root_pid))
        .ok_or_else(|| SnapshotError::Incomplete("The shell process is absent".into()))?;
    let observed_creation = root_record.creation_date.ok_or_else(|| {
        SnapshotError::Incomplete("The shell snapshot has no creation date".into())
    })?;
    if observed_creation != root_creation {
        return Err(SnapshotError::Incomplete(
            "The shell process id was reused".into(),
        ));
    }

    let descendants = collect_descendants(records, root_pid, root_creation)?;
    if descendants.is_empty() {
        return Ok(ProcessClassification {
            kind: ProcessKind::IdleShell,
            agent: None,
            process: None,
        });
    }

    let mut candidates = Vec::new();
    for descendant in &descendants {
        if let Some(candidate) = agent_candidate(descendant)? {
            candidates.push(candidate);
        }
    }
    if let Some(candidate) = candidates.into_iter().max_by_key(candidate_rank) {
        return Ok(ProcessClassification {
            kind: ProcessKind::Agent,
            agent: Some(candidate.identity),
            process: Some(candidate.process),
        });
    }

    let process = descendants
        .iter()
        .max_by_key(|descendant| {
            (
                descendant.depth,
                descendant.creation_date,
                descendant.process_id,
            )
        })
        .and_then(|descendant| normalized_executable(descendant.record));
    Ok(ProcessClassification {
        kind: ProcessKind::Busy,
        agent: None,
        process,
    })
}

fn collect_descendants<'a>(
    records: &'a [ProcessRecord],
    root_pid: u32,
    root_creation: i64,
) -> Result<Vec<Descendant<'a>>, SnapshotError> {
    let mut children: HashMap<u32, Vec<&ProcessRecord>> = HashMap::new();
    for record in records {
        if let Some(parent_pid) = record.parent_process_id {
            children.entry(parent_pid).or_default().push(record);
        }
    }

    let mut descendants = Vec::new();
    let mut queue = VecDeque::from([(root_pid, 0usize)]);
    let mut visited = HashSet::from([root_pid]);
    while let Some((parent_pid, parent_depth)) = queue.pop_front() {
        for record in children.get(&parent_pid).into_iter().flatten() {
            let process_id = record.process_id.ok_or_else(|| {
                SnapshotError::Incomplete("A descendant process id is unavailable".into())
            })?;
            let creation_date = record.creation_date.ok_or_else(|| {
                SnapshotError::Incomplete(format!("Process {process_id} has no creation date"))
            })?;
            if creation_date < root_creation || !visited.insert(process_id) {
                continue;
            }
            let depth = parent_depth + 1;
            descendants.push(Descendant {
                record,
                process_id,
                creation_date,
                depth,
            });
            queue.push_back((process_id, depth));
        }
    }
    Ok(descendants)
}

fn agent_candidate(descendant: &Descendant<'_>) -> Result<Option<AgentCandidate>, SnapshotError> {
    let executable = normalized_executable(descendant.record).ok_or_else(|| {
        SnapshotError::Incomplete(format!(
            "Process {} has no executable identity",
            descendant.process_id
        ))
    })?;
    if let Some(identity) = direct_agent(&executable) {
        return Ok(Some(AgentCandidate {
            identity,
            process: executable,
            direct: true,
            depth: descendant.depth,
            creation_date: descendant.creation_date,
            process_id: descendant.process_id,
        }));
    }
    if !is_wrapper(&executable) {
        return Ok(None);
    }

    let command_line = descendant.record.command_line.as_deref().ok_or_else(|| {
        SnapshotError::Incomplete(format!(
            "Wrapper process {} has no command line",
            descendant.process_id
        ))
    })?;
    Ok(wrapper_agent(command_line).map(|identity| AgentCandidate {
        identity,
        process: executable,
        direct: false,
        depth: descendant.depth,
        creation_date: descendant.creation_date,
        process_id: descendant.process_id,
    }))
}

fn candidate_rank(candidate: &AgentCandidate) -> (bool, usize, i64, u32) {
    (
        candidate.direct,
        candidate.depth,
        candidate.creation_date,
        candidate.process_id,
    )
}

fn direct_agent(executable: &str) -> Option<AgentIdentity> {
    match executable {
        "claude" => Some(AgentIdentity::Claude),
        "codex" => Some(AgentIdentity::Codex),
        "gemini" => Some(AgentIdentity::Gemini),
        _ => None,
    }
}

fn is_wrapper(executable: &str) -> bool {
    matches!(executable, "node" | "cmd" | "powershell" | "pwsh")
}

fn wrapper_agent(command_line: &str) -> Option<AgentIdentity> {
    const SIGNATURES: [(&str, AgentIdentity); 3] = [
        ("@anthropic-ai/claude-code", AgentIdentity::Claude),
        ("@openai/codex", AgentIdentity::Codex),
        ("@google/gemini-cli", AgentIdentity::Gemini),
    ];

    split_windows_command_line(command_line)
        .iter()
        .find_map(|argument| {
            let normalized = argument.replace('\\', "/").to_ascii_lowercase();
            SIGNATURES
                .iter()
                .find(|(signature, _)| contains_path_signature(&normalized, signature))
                .map(|(_, identity)| *identity)
        })
}

fn contains_path_signature(argument: &str, signature: &str) -> bool {
    argument.match_indices(signature).any(|(start, _)| {
        let end = start + signature.len();
        matches!(argument[..start].chars().next_back(), None | Some('/'))
            && matches!(argument[end..].chars().next(), None | Some('/'))
    })
}

fn normalized_executable(record: &ProcessRecord) -> Option<String> {
    record
        .name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .or_else(|| record.executable_path.as_deref())
        .and_then(|value| value.rsplit(['\\', '/']).next())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| {
            let lowered = name.to_ascii_lowercase();
            [".exe", ".cmd", ".bat", ".ps1"]
                .iter()
                .find_map(|suffix| lowered.strip_suffix(suffix))
                .unwrap_or(&lowered)
                .to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::{
        classify_many, AgentIdentity, ProcessClassification, ProcessKind, ProcessRecord,
        ProcessSnapshotProvider, SessionProcessRoot, SnapshotError,
    };
    use std::cell::Cell;

    const ROOT_CREATED: i64 = 1_000;

    struct FixtureProvider {
        calls: Cell<usize>,
        rows: Result<Vec<ProcessRecord>, SnapshotError>,
    }

    impl FixtureProvider {
        fn with_rows(rows: Vec<ProcessRecord>) -> Self {
            Self {
                calls: Cell::new(0),
                rows: Ok(rows),
            }
        }
    }

    impl ProcessSnapshotProvider for FixtureProvider {
        fn snapshot(&self) -> Result<Vec<ProcessRecord>, SnapshotError> {
            self.calls.set(self.calls.get() + 1);
            self.rows.clone()
        }
    }

    fn root(session_id: u32, process_id: u32) -> SessionProcessRoot {
        SessionProcessRoot {
            session_id,
            process_id: Some(process_id),
            creation_date: Some(ROOT_CREATED),
        }
    }

    fn record(
        process_id: u32,
        parent_process_id: Option<u32>,
        creation_date: i64,
        name: &str,
        command_line: Option<&str>,
    ) -> ProcessRecord {
        ProcessRecord {
            process_id: Some(process_id),
            parent_process_id,
            creation_date: Some(creation_date),
            name: Some(name.into()),
            executable_path: Some(format!(r"C:\Tools\{name}")),
            command_line: command_line.map(str::to_string),
        }
    }

    fn classify(
        rows: Vec<ProcessRecord>,
        session_root: SessionProcessRoot,
    ) -> Result<ProcessClassification, SnapshotError> {
        classify_many(&FixtureProvider::with_rows(rows), &[session_root])
            .pop()
            .expect("one classification")
            .1
    }

    #[test]
    fn classifies_direct_agent_binaries() {
        let rows = vec![
            record(10, None, ROOT_CREATED, "pwsh.exe", None),
            record(11, Some(10), ROOT_CREATED + 1, "claude.exe", None),
        ];

        assert_eq!(
            classify(rows, root(1, 10)),
            Ok(ProcessClassification {
                kind: ProcessKind::Agent,
                agent: Some(AgentIdentity::Claude),
                process: Some("claude".into()),
            })
        );
    }

    #[test]
    fn classifies_versioned_npm_shim_signatures() {
        let signatures = [
            (
                r#"node.exe "C:\npm\node_modules\@anthropic-ai\claude-code\cli.js""#,
                AgentIdentity::Claude,
            ),
            (
                r#"node.exe "C:\npm\node_modules\@openai\codex\bin\codex.js""#,
                AgentIdentity::Codex,
            ),
            (
                r#"node.exe "C:\npm\node_modules\@google\gemini-cli\dist\index.js""#,
                AgentIdentity::Gemini,
            ),
        ];

        for (command_line, expected) in signatures {
            let rows = vec![
                record(10, None, ROOT_CREATED, "pwsh.exe", None),
                record(
                    11,
                    Some(10),
                    ROOT_CREATED + 1,
                    "node.exe",
                    Some(command_line),
                ),
            ];
            let classification = classify(rows, root(1, 10)).unwrap();
            assert_eq!(classification.kind, ProcessKind::Agent);
            assert_eq!(classification.agent, Some(expected));
        }
    }

    #[test]
    fn does_not_treat_unsigned_node_as_an_agent() {
        let rows = vec![
            record(10, None, ROOT_CREATED, "pwsh.exe", None),
            record(
                11,
                Some(10),
                ROOT_CREATED + 1,
                "node.exe",
                Some("node.exe server.js"),
            ),
        ];

        assert_eq!(classify(rows, root(1, 10)).unwrap().kind, ProcessKind::Busy);

        let lookalike = vec![
            record(10, None, ROOT_CREATED, "pwsh.exe", None),
            record(
                11,
                Some(10),
                ROOT_CREATED + 1,
                "node.exe",
                Some(r#"node.exe C:\node_modules\@openai\codex-malicious\index.js"#),
            ),
        ];
        assert_eq!(
            classify(lookalike, root(1, 10)).unwrap().kind,
            ProcessKind::Busy
        );
    }

    #[test]
    fn normalizes_supported_executable_suffixes() {
        for name in ["CODEX.EXE", "codex.cmd", "codex.BAT", "codex.ps1"] {
            let rows = vec![
                record(10, None, ROOT_CREATED, "pwsh.exe", None),
                record(11, Some(10), ROOT_CREATED + 1, name, None),
            ];
            assert_eq!(
                classify(rows, root(1, 10)).unwrap().agent,
                Some(AgentIdentity::Codex),
                "{name}"
            );
        }
    }

    #[test]
    fn rejects_reused_root_and_older_descendant_pids() {
        let reused_root = vec![record(10, None, ROOT_CREATED + 10, "pwsh.exe", None)];
        assert!(matches!(
            classify(reused_root, root(1, 10)),
            Err(SnapshotError::Incomplete(_))
        ));

        let older_child = vec![
            record(10, None, ROOT_CREATED, "pwsh.exe", None),
            record(11, Some(10), ROOT_CREATED - 1, "claude.exe", None),
        ];
        assert_eq!(
            classify(older_child, root(1, 10)).unwrap().kind,
            ProcessKind::IdleShell
        );
    }

    #[test]
    fn applies_agent_candidate_precedence() {
        let rows = vec![
            record(10, None, ROOT_CREATED, "pwsh.exe", None),
            record(
                11,
                Some(10),
                ROOT_CREATED + 10,
                "node.exe",
                Some(r#"node.exe C:\node_modules\@openai\codex\bin\codex.js"#),
            ),
            record(12, Some(11), ROOT_CREATED + 11, "worker.exe", None),
            record(20, Some(10), ROOT_CREATED + 1, "claude.exe", None),
            record(21, Some(20), ROOT_CREATED + 2, "gemini.exe", None),
            record(22, Some(20), ROOT_CREATED + 3, "gemini.exe", None),
            record(23, Some(20), ROOT_CREATED + 3, "gemini.exe", None),
        ];

        let classification = classify(rows, root(1, 10)).unwrap();
        assert_eq!(classification.agent, Some(AgentIdentity::Gemini));
        assert_eq!(classification.process, Some("gemini".into()));
    }

    #[test]
    fn distinguishes_idle_shells_from_busy_descendants() {
        let idle = vec![record(10, None, ROOT_CREATED, "pwsh.exe", None)];
        assert_eq!(
            classify(idle, root(1, 10)).unwrap().kind,
            ProcessKind::IdleShell
        );

        let busy = vec![
            record(10, None, ROOT_CREATED, "pwsh.exe", None),
            record(11, Some(10), ROOT_CREATED + 1, "git.exe", None),
        ];
        let classification = classify(busy, root(1, 10)).unwrap();
        assert_eq!(classification.kind, ProcessKind::Busy);
        assert_eq!(classification.process, Some("git".into()));
    }

    #[test]
    fn reports_incomplete_required_process_facts() {
        let provider = FixtureProvider::with_rows(vec![ProcessRecord {
            process_id: Some(10),
            parent_process_id: None,
            creation_date: None,
            name: Some("pwsh.exe".into()),
            executable_path: None,
            command_line: None,
        }]);
        let missing_root_creation = SessionProcessRoot {
            session_id: 1,
            process_id: Some(10),
            creation_date: None,
        };

        for session_root in [root(1, 10), missing_root_creation] {
            assert!(matches!(
                classify_many(&provider, &[session_root])[0].1,
                Err(SnapshotError::Incomplete(_))
            ));
        }
    }

    #[test]
    fn queries_wmi_once_for_many_panes() {
        let provider = FixtureProvider::with_rows(vec![
            record(10, None, ROOT_CREATED, "pwsh.exe", None),
            record(20, None, ROOT_CREATED, "pwsh.exe", None),
        ]);

        let results = classify_many(&provider, &[root(1, 10), root(2, 20)]);

        assert_eq!(results.len(), 2);
        assert_eq!(provider.calls.get(), 1);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn connects_and_deserializes_win32_process_snapshot() {
        use super::{process_creation_date, WmiProcessSnapshotProvider};

        let rows = WmiProcessSnapshotProvider
            .snapshot()
            .expect("query Win32_Process");
        let current = rows
            .iter()
            .find(|record| record.process_id == Some(std::process::id()))
            .expect("current test process in WMI snapshot");

        assert!(current.creation_date.is_some());
        assert!(current.name.is_some());
        assert_eq!(
            process_creation_date(std::process::id()).expect("query current process identity"),
            current
                .creation_date
                .expect("current process creation date")
        );
    }
}
