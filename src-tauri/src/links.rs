use crate::platform;
#[cfg(any(target_os = "windows", test))]
use crate::platform::windows::command_line::parse_windows_command_line;
use crate::shell_integration::has_rejected_root;
use serde::Deserialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

/// Upper bound on one hover's resolve batch — the frontend already caps its
/// candidates per line, this just keeps a hostile/garbled line cheap.
const MAX_PATHS: usize = 64;
const MAX_PATH_BYTES: usize = 32_768;
const MAX_EDITOR_TEMPLATE_BYTES: usize = 4_096;

/// A GUI editor returns immediately; anything still running past this has
/// launched (or the login shell is hanging) — either way, stop waiting.
const EDITOR_TIMEOUT: Duration = Duration::from_secs(10);

/// How often the launched editor is checked for having exited. Short enough
/// that a "command not found" surfaces immediately, long enough to be free.
const EDITOR_POLL: Duration = Duration::from_millis(25);

fn is_windows_absolute(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/'))
        || raw.starts_with(r"\\")
}

fn expand_tilde(raw: &str, home: Option<&Path>) -> Option<PathBuf> {
    if raw == "~" {
        return home.map(Path::to_path_buf);
    }
    let rest = raw.strip_prefix("~/").or_else(|| raw.strip_prefix(r"~\"));
    let Some(rest) = rest else {
        return Some(PathBuf::from(raw));
    };
    let home = home?;
    let home_text = home.to_string_lossy();
    let separator = if home_text.contains('\\') && !home_text.contains('/') {
        '\\'
    } else {
        '/'
    };
    let home_root = home_text.trim_end_matches(['/', '\\']);
    Some(PathBuf::from(format!("{home_root}{separator}{rest}")))
}

fn strip_prefix_ascii_case<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    let candidate = value.get(..prefix.len())?;
    candidate
        .eq_ignore_ascii_case(prefix)
        .then(|| &value[prefix.len()..])
}

fn normalize_canonical_path(path: &str) -> String {
    const VERBATIM_UNC: &str = "\\\\?\\UNC\\";
    const VERBATIM: &str = "\\\\?\\";

    if let Some(rest) = strip_prefix_ascii_case(path, VERBATIM_UNC) {
        return format!(r"\\{rest}");
    }
    strip_prefix_ascii_case(path, VERBATIM)
        .unwrap_or(path)
        .to_string()
}

/// Absolute path of `raw` when it is an existing FILE, else `None`.
///
/// `base` is `None` when the pane's cwd is not known. A relative candidate is
/// then unresolvable and comes back `None`: guessing a base would let
/// `src/main.ts` printed by an agent in `~/work/api` resolve to an unrelated
/// `~/src/main.ts` that happens to exist, and ⌘+click would open the wrong
/// file with the hover text looking exactly right. An absolute or `~` path
/// carries its own base and still resolves.
///
/// Directories are deliberately not linkified: there is no line to jump to and
/// `code -g <dir>:1:1` is meaningless.
fn resolve_one(base: Option<&Path>, home: Option<&Path>, raw: &str) -> Option<String> {
    let expanded = expand_tilde(raw, home)?;
    let expanded_text = expanded.to_string_lossy();
    let full = if expanded.is_absolute() || is_windows_absolute(&expanded_text) {
        expanded
    } else {
        base?.join(expanded)
    };
    // Reject a network/verbatim root before the filesystem call below: on
    // Windows `canonicalize()` on a `\\host\share` candidate is a blocking
    // `CreateFileW` into the SMB redirector (~21 s per unreachable host) that
    // also offers the interactive user's NTLMv2 credentials to whatever host
    // hover text names. `raw` is untrusted terminal output — see
    // `has_rejected_root` in `shell_integration.rs` for the shared guarantee.
    if has_rejected_root(&full.to_string_lossy(), &full) {
        return None;
    }
    let canonical = std::fs::canonicalize(full).ok()?;
    canonical
        .is_file()
        .then(|| normalize_canonical_path(&canonical.to_string_lossy()))
}

/// Resolve terminal-link path candidates against a pane's cwd. The result is
/// index-aligned with `paths`; a candidate that is not an existing file (or a
/// candidate past `MAX_PATHS`) comes back as `None`. An empty `cwd` — a pane
/// whose info has not been polled yet, or whose foreground process the kernel
/// will not report on — resolves only the candidates that are already absolute;
/// see `resolve_one` for why relative ones are dropped rather than guessed at.
#[tauri::command]
pub async fn resolve_paths(cwd: String, paths: Vec<String>) -> Vec<Option<String>> {
    let home = platform::user_home().ok();
    let candidate_base = PathBuf::from(&cwd);
    let base = (!cwd.is_empty()
        && (candidate_base.is_absolute() || is_windows_absolute(&cwd))
        && candidate_base.is_dir())
    .then_some(candidate_base);
    paths
        .iter()
        .enumerate()
        .map(|(i, raw)| {
            if i < MAX_PATHS && raw.len() <= MAX_PATH_BYTES {
                resolve_one(base.as_deref(), home.as_deref(), raw)
            } else {
                None
            }
        })
        .collect()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenEditorRequest {
    editor: String,
    template: String,
    file: String,
    line: i64,
    column: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EditorId {
    Vscode,
    Cursor,
    Zed,
    Custom,
}

impl EditorId {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "vscode" => Ok(Self::Vscode),
            "cursor" => Ok(Self::Cursor),
            "zed" => Ok(Self::Zed),
            "custom" => Ok(Self::Custom),
            _ => Err("The selected editor is not supported.".into()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ValidatedOpenEditorRequest {
    editor: EditorId,
    template: String,
    file: String,
    line: u32,
    column: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct EditorProgram {
    executable: String,
    args: Vec<String>,
}

fn paths_match(requested: &str, canonical: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        return requested.replace('/', "\\").eq_ignore_ascii_case(canonical);
    }

    #[cfg(not(target_os = "windows"))]
    {
        requested == canonical
    }
}

fn positive_editor_position(value: i64, label: &str) -> Result<u32, String> {
    u32::try_from(value)
        .ok()
        .filter(|position| *position > 0)
        .ok_or_else(|| format!("The editor {label} must be a positive number."))
}

fn validate_open_editor_request(
    request: OpenEditorRequest,
) -> Result<ValidatedOpenEditorRequest, String> {
    let editor = EditorId::parse(&request.editor)?;
    if request.template.len() > MAX_EDITOR_TEMPLATE_BYTES || request.template.contains('\0') {
        return Err("The custom editor command is invalid or too long.".into());
    }
    if request.file.len() > MAX_PATH_BYTES || request.file.contains('\0') {
        return Err("The editor file path is invalid or too long.".into());
    }
    let template = request.template.trim();
    if editor == EditorId::Custom && template.is_empty() {
        return Err("No custom editor command is configured.".into());
    }
    let executable_token = template.split_whitespace().next().unwrap_or_default();
    if editor == EditorId::Custom
        && ["{file}", "{line}", "{col}"]
            .iter()
            .any(|placeholder| executable_token.contains(placeholder))
    {
        return Err("The custom editor executable must be a fixed command.".into());
    }
    let line = positive_editor_position(request.line, "line")?;
    let column = positive_editor_position(request.column, "column")?;
    if strip_prefix_ascii_case(&request.file, "\\\\?\\").is_some() {
        return Err("The editor file path must not use a verbatim prefix.".into());
    }
    let file = PathBuf::from(&request.file);
    if !(file.is_absolute() || is_windows_absolute(&request.file)) {
        return Err("The editor file path must be absolute.".into());
    }
    // Same guard as `resolve_one`: a Ctrl+click reaches this path too, and
    // `canonicalize()` below must never be handed a `\\host\share` root — see
    // `has_rejected_root` in `shell_integration.rs`.
    if has_rejected_root(&request.file, &file) {
        return Err("The editor file path must not be a network location.".into());
    }
    let canonical = std::fs::canonicalize(&file)
        .map_err(|_| "The editor file does not exist or cannot be read.".to_string())?;
    if !canonical.is_file() {
        return Err("The editor target must be a file.".into());
    }
    let canonical = normalize_canonical_path(&canonical.to_string_lossy());
    if !paths_match(&request.file, &canonical) {
        return Err("The editor file path is not canonical.".into());
    }
    Ok(ValidatedOpenEditorRequest {
        editor,
        template: template.to_string(),
        file: canonical,
        line,
        column,
    })
}

fn fixed_editor_program(request: &ValidatedOpenEditorRequest) -> Result<EditorProgram, String> {
    let location = format!("{}:{}:{}", request.file, request.line, request.column);
    match request.editor {
        EditorId::Vscode => Ok(EditorProgram {
            executable: "code".into(),
            args: vec!["-g".into(), location],
        }),
        EditorId::Cursor => Ok(EditorProgram {
            executable: "cursor".into(),
            args: vec!["-g".into(), location],
        }),
        EditorId::Zed => Ok(EditorProgram {
            executable: "zed".into(),
            args: vec![location],
        }),
        EditorId::Custom => Err("A custom editor needs a command template.".into()),
    }
}

#[cfg(any(target_os = "windows", test))]
fn substitute_editor_placeholders(argument: &str, request: &ValidatedOpenEditorRequest) -> String {
    argument
        .replace("{line}", &request.line.to_string())
        .replace("{col}", &request.column.to_string())
        .replace("{file}", &request.file)
}

#[cfg(any(target_os = "windows", test))]
fn rejects_shell_syntax(template: &str) -> bool {
    template.chars().any(|character| {
        matches!(
            character,
            '|' | '&' | ';' | '<' | '>' | '%' | '$' | '!' | '`' | '^' | '\r' | '\n'
        )
    })
}

#[cfg(any(target_os = "windows", test))]
fn windows_editor_program(request: &ValidatedOpenEditorRequest) -> Result<EditorProgram, String> {
    if request.editor != EditorId::Custom {
        return fixed_editor_program(request);
    }
    if request.template.is_empty() {
        return Err("No custom editor command is configured.".into());
    }
    if rejects_shell_syntax(&request.template) {
        return Err(
            "Custom editor commands cannot use shell operators or variables on Windows.".into(),
        );
    }
    let parsed = parse_windows_command_line(&request.template)?;
    let (executable, arguments) = parsed
        .split_first()
        .ok_or_else(|| "No custom editor executable is configured.".to_string())?;
    if executable.trim().is_empty()
        || ["{file}", "{line}", "{col}"]
            .iter()
            .any(|placeholder| executable.contains(placeholder))
    {
        return Err("The custom editor executable must be a fixed command.".into());
    }
    let has_file = arguments.iter().any(|argument| argument.contains("{file}"));
    let argument_templates: Vec<&str> = if has_file {
        arguments.iter().map(String::as_str).collect()
    } else {
        arguments
            .iter()
            .map(String::as_str)
            .chain(std::iter::once("{file}"))
            .collect()
    };
    Ok(EditorProgram {
        executable: executable.clone(),
        args: argument_templates
            .into_iter()
            .map(|argument| substitute_editor_placeholders(argument, request))
            .collect(),
    })
}

fn posix_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

fn posix_editor_command(request: &ValidatedOpenEditorRequest) -> Result<String, String> {
    if request.editor != EditorId::Custom {
        let program = fixed_editor_program(request)?;
        return Ok(std::iter::once(program.executable)
            .chain(program.args)
            .map(|argument| posix_quote(&argument))
            .collect::<Vec<_>>()
            .join(" "));
    }
    if request.template.is_empty() {
        return Err("No custom editor command is configured.".into());
    }
    let template = if request.template.contains("{file}") {
        request.template.clone()
    } else {
        format!("{} {{file}}", request.template)
    };
    Ok(template
        .replace("{line}", &request.line.to_string())
        .replace("{col}", &request.column.to_string())
        .replace("{file}", &posix_quote(&request.file)))
}

fn prepare_editor_program(request: &ValidatedOpenEditorRequest) -> Result<EditorProgram, String> {
    #[cfg(target_os = "windows")]
    {
        return windows_editor_program(request);
    }

    #[cfg(target_os = "macos")]
    {
        let command = posix_editor_command(request)?;
        let launch = platform::shell_launch()?;
        return Ok(EditorProgram {
            executable: launch.executable,
            args: launch
                .args
                .into_iter()
                .chain(["-c".into(), command])
                .collect(),
        });
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = request;
        Err("Opening an editor is unavailable on this platform.".into())
    }
}

async fn run_editor_program(program: EditorProgram) -> Result<(), String> {
    let mut child = std::process::Command::new(&program.executable)
        .args(program.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Couldn't start the editor: {err}"))?;

    let deadline = Instant::now() + EDITOR_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    return Ok(());
                }
                tokio::time::sleep(EDITOR_POLL).await;
            }
            Err(err) => return Err(format!("Couldn't start the editor: {err}")),
        }
    };
    if status.success() {
        return Ok(());
    }
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut stderr);
    }
    let stderr = stderr.trim().to_string();
    Err(if stderr.is_empty() {
        format!("The editor command exited with {status}.")
    } else {
        stderr
    })
}

/// Validate structured editor intent, then launch through the platform adapter.
/// Windows executes fixed argv directly; macOS keeps its login-shell PATH
/// discovery without letting terminal text choose the executable.
#[tauri::command]
pub async fn open_editor(request: OpenEditorRequest) -> Result<(), String> {
    let validated = validate_open_editor_request(request)?;
    let program = prepare_editor_program(&validated)?;
    run_editor_program(program).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_dir() -> PathBuf {
        let dir = std::env::temp_dir().join("stackgrid-links-test");
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/foo.ts"), "x").unwrap();
        dir
    }

    #[test]
    fn recognizes_windows_drive_and_unc_absolute_paths_portably() {
        assert!(is_windows_absolute(r"C:\Users\dev\file.ts"));
        assert!(is_windows_absolute("c:/Users/dev/file.ts"));
        assert!(is_windows_absolute(r"\\server\share\file.ts"));
        assert!(!is_windows_absolute(r"C:src\file.ts"));
        assert!(!is_windows_absolute(r"src\file.ts"));
    }

    #[test]
    fn tilde_expansion_preserves_the_home_separator_style() {
        let windows_home = Path::new(r"C:\Users\Dev");
        assert_eq!(
            expand_tilde(r"~\src\file.ts", Some(windows_home)),
            Some(PathBuf::from(r"C:\Users\Dev\src\file.ts"))
        );
        assert_eq!(
            expand_tilde("~/src/file.ts", Some(windows_home)),
            Some(PathBuf::from(r"C:\Users\Dev\src/file.ts"))
        );
    }

    #[test]
    fn tilde_expansion_requires_the_platform_home_provider() {
        assert_eq!(expand_tilde("~/src/file.ts", None), None);
        assert_eq!(
            expand_tilde("src/file.ts", None),
            Some(PathBuf::from("src/file.ts"))
        );
    }

    #[test]
    fn removes_windows_verbatim_prefixes_at_the_display_boundary() {
        assert_eq!(
            normalize_canonical_path(r"\\?\C:\Users\Dev\file.ts"),
            r"C:\Users\Dev\file.ts"
        );
        assert_eq!(
            normalize_canonical_path(r"\\?\UNC\Server\Share\file.ts"),
            r"\\Server\Share\file.ts"
        );
    }

    #[test]
    fn verbatim_prefix_comparison_is_ascii_case_insensitive() {
        assert_eq!(
            normalize_canonical_path(r"\\?\unc\Server\Share\file.ts"),
            r"\\Server\Share\file.ts"
        );
    }

    #[test]
    fn canonical_normalization_preserves_non_verbatim_text_and_separators() {
        assert_eq!(
            normalize_canonical_path("C:/Users/Dev/file.ts"),
            "C:/Users/Dev/file.ts"
        );
        assert_eq!(
            normalize_canonical_path(r"\\Server\Share\file.ts"),
            r"\\Server\Share\file.ts"
        );
        assert_eq!(
            normalize_canonical_path("/Users/Dev/file.ts"),
            "/Users/Dev/file.ts"
        );
    }

    #[test]
    fn resolves_a_relative_path_against_the_cwd() {
        let dir = fixture_dir();
        let resolved = resolve_one(Some(&dir), None, "src/foo.ts").unwrap();
        assert!(PathBuf::from(resolved).ends_with(Path::new("src").join("foo.ts")));
    }

    #[test]
    fn resolves_an_absolute_path_ignoring_the_cwd() {
        let dir = fixture_dir();
        let abs = dir.join("src/foo.ts").to_string_lossy().into_owned();
        assert!(resolve_one(Some(Path::new("/nowhere")), None, &abs).is_some());
    }

    #[test]
    fn expands_a_tilde_path() {
        let dir = fixture_dir();
        assert!(resolve_one(Some(Path::new("/nowhere")), Some(&dir), "~/src/foo.ts").is_some());
    }

    #[test]
    fn rejects_a_missing_file() {
        let dir = fixture_dir();
        assert_eq!(resolve_one(Some(&dir), None, "src/nope.ts"), None);
    }

    #[test]
    fn rejects_a_directory() {
        let dir = fixture_dir();
        assert_eq!(resolve_one(Some(&dir), None, "src"), None);
    }

    /// An unknown cwd must not silently borrow one: a relative candidate that
    /// happens to exist under some other root would open the wrong file.
    #[test]
    fn drops_a_relative_path_when_the_cwd_is_unknown() {
        let dir = fixture_dir();
        assert_eq!(resolve_one(None, Some(&dir), "src/foo.ts"), None);
    }

    #[test]
    fn still_resolves_absolute_and_tilde_paths_when_the_cwd_is_unknown() {
        let dir = fixture_dir();
        let abs = dir.join("src/foo.ts").to_string_lossy().into_owned();
        assert!(resolve_one(None, Some(&dir), &abs).is_some());
        assert!(resolve_one(None, Some(&dir), "~/src/foo.ts").is_some());
    }

    /// `resolve_one`'s guard calls `has_rejected_root` from
    /// `shell_integration.rs` — asserted here directly rather than through
    /// `resolve_one`: on this macOS host `std::fs::canonicalize` already
    /// fails for a nonexistent `\\host\share\...` candidate (POSIX has no
    /// `\` separator, so the whole string is one literal, nonexistent
    /// filename), so a black-box `resolve_one(...) == None` check passes for
    /// the wrong reason with or without the guard — see
    /// `rejects_a_unc_candidate_end_to_end` below, which is kept only as a
    /// contract pin, not as proof. The proof runs on Windows, in
    /// `resolves_real_windows_drive_and_relative_paths_but_rejects_unc`.
    #[test]
    fn resolve_one_guard_predicate_rejects_unc_roots() {
        for candidate in [
            r"\\10.255.255.1\share\file.ts",
            r"\\corp\projects\deck\src\main.ts",
        ] {
            assert!(
                has_rejected_root(candidate, &PathBuf::from(candidate)),
                "{candidate} must be rejected before canonicalize"
            );
        }
    }

    /// Black-box contract test kept alongside the predicate test above even
    /// though it cannot fail on this dev host without the guard (see that
    /// test's doc comment) — it still pins the observable behaviour and would
    /// catch a guard wired to the wrong branch.
    #[test]
    fn rejects_a_unc_candidate_end_to_end() {
        let dir = fixture_dir();
        assert_eq!(
            resolve_one(Some(&dir), None, r"\\10.255.255.1\share\file.ts"),
            None
        );
    }

    #[test]
    fn resolve_one_still_resolves_an_ordinary_absolute_path() {
        let dir = fixture_dir();
        let abs = dir.join("src/foo.ts").to_string_lossy().into_owned();
        assert!(!has_rejected_root(&abs, &PathBuf::from(&abs)));
        assert!(resolve_one(Some(Path::new("/nowhere")), None, &abs).is_some());
    }

    #[test]
    fn resolve_paths_with_an_empty_cwd_keeps_only_the_absolute_candidates() {
        let dir = fixture_dir();
        let abs = dir.join("src/foo.ts").to_string_lossy().into_owned();
        let results = tauri::async_runtime::block_on(resolve_paths(
            String::new(),
            vec!["src/foo.ts".into(), abs],
        ));
        assert_eq!(results[0], None);
        assert!(results[1].is_some());
    }

    #[test]
    fn resolve_paths_keeps_the_input_order() {
        let dir = fixture_dir();
        let cwd = dir.to_string_lossy().into_owned();
        let results = tauri::async_runtime::block_on(resolve_paths(
            cwd,
            vec!["nope.ts".into(), "src/foo.ts".into()],
        ));
        assert_eq!(results.len(), 2);
        assert!(results[0].is_none());
        assert!(results[1].is_some());
    }

    #[test]
    fn resolve_paths_keeps_alignment_across_count_and_length_bounds() {
        let dir = fixture_dir();
        let cwd = dir.to_string_lossy().into_owned();
        let mut paths = vec!["src/foo.ts".to_string(); MAX_PATHS];
        paths.push("x".repeat(MAX_PATH_BYTES + 1));
        paths.push("src/foo.ts".to_string());

        let results = tauri::async_runtime::block_on(resolve_paths(cwd, paths));

        assert_eq!(results.len(), MAX_PATHS + 2);
        assert!(results[..MAX_PATHS].iter().all(Option::is_some));
        assert_eq!(results[MAX_PATHS], None);
        assert_eq!(results[MAX_PATHS + 1], None);
    }

    /// The UNC assertion is the suite's only non-vacuous proof of
    /// `resolve_one`'s guard. `\\localhost\<drive>$\...` names the very file
    /// the drive assertion above resolves, over a share this host can reach —
    /// the same assertion read `is_some()` and passed on CI until the guard
    /// landed. So `None` here can only come from the guard, whereas the macOS
    /// tests above cannot tell a guarded UNC from one `canonicalize` rejects
    /// on its own.
    ///
    /// Linkifying UNC paths is deliberately given up for that guard: hover is
    /// passive, and a probe into a host named by terminal output stalls the
    /// resolve on an unreachable share and offers the interactive user's
    /// NTLMv2 credentials to whoever chose the name. A UNC path is still
    /// copy-pasteable, just not Ctrl+clickable.
    #[cfg(target_os = "windows")]
    #[test]
    fn resolves_real_windows_drive_and_relative_paths_but_rejects_unc() {
        let dir = fixture_dir();
        let file = dir.join("src").join("foo.ts");
        let drive_path = file.to_string_lossy().into_owned();
        let drive = drive_path
            .chars()
            .next()
            .expect("the Windows temp directory must have a drive");
        let drive_rest = drive_path
            .get(3..)
            .expect("the Windows temp path must start with a drive root");
        let unc_path = format!(r"\\localhost\{}$\{drive_rest}", drive.to_ascii_uppercase());

        assert!(resolve_one(None, None, &drive_path).is_some());
        assert_eq!(resolve_one(None, None, &unc_path), None);
        assert!(resolve_one(Some(&dir), None, r"src\foo.ts").is_some());
        assert_eq!(resolve_one(Some(&dir), None, r"src\missing.ts"), None);
        assert_eq!(resolve_one(Some(&dir), None, "src"), None);
        assert_eq!(resolve_one(None, None, r"src\foo.ts"), None);
    }

    fn validated_request(
        editor: EditorId,
        template: &str,
        file: &str,
    ) -> ValidatedOpenEditorRequest {
        ValidatedOpenEditorRequest {
            editor,
            template: template.into(),
            file: file.into(),
            line: 12,
            column: 4,
        }
    }

    #[test]
    fn fixed_editors_have_non_shell_argv() {
        let vscode =
            fixed_editor_program(&validated_request(EditorId::Vscode, "", r"C:\work\a b.ts"))
                .unwrap();
        assert_eq!(
            vscode,
            EditorProgram {
                executable: "code".into(),
                args: vec!["-g".into(), r"C:\work\a b.ts:12:4".into()],
            }
        );

        let cursor = fixed_editor_program(&validated_request(
            EditorId::Cursor,
            "",
            r"\\server\share\日本語.ts",
        ))
        .unwrap();
        assert_eq!(cursor.executable, "cursor");
        assert_eq!(cursor.args, vec!["-g", r"\\server\share\日本語.ts:12:4"]);

        let zed =
            fixed_editor_program(&validated_request(EditorId::Zed, "", "/work/a b.ts")).unwrap();
        assert_eq!(zed.executable, "zed");
        assert_eq!(zed.args, vec!["/work/a b.ts:12:4"]);
    }

    #[test]
    fn custom_windows_template_substitutes_after_argv_parsing() {
        let request = validated_request(
            EditorId::Custom,
            r#""C:\Program Files\Editor\editor.exe" --goto "{file}:{line}:{col}""#,
            r"\\server\share\a b-日本語.ts",
        );

        assert_eq!(
            windows_editor_program(&request).unwrap(),
            EditorProgram {
                executable: r"C:\Program Files\Editor\editor.exe".into(),
                args: vec!["--goto".into(), r"\\server\share\a b-日本語.ts:12:4".into()],
            }
        );
    }

    #[test]
    fn custom_template_without_a_file_placeholder_appends_the_file() {
        let request = validated_request(EditorId::Custom, "editor.exe --wait", r"C:\work\a b.ts");

        assert_eq!(
            windows_editor_program(&request).unwrap(),
            EditorProgram {
                executable: "editor.exe".into(),
                args: vec!["--wait".into(), r"C:\work\a b.ts".into()],
            }
        );
    }

    #[test]
    fn file_text_is_never_reparsed_as_a_placeholder() {
        let request = validated_request(
            EditorId::Custom,
            "editor.exe {file}:{line}:{col}",
            r"C:\work\literal-{line}-{col}.ts",
        );

        assert_eq!(
            windows_editor_program(&request).unwrap().args,
            vec![r"C:\work\literal-{line}-{col}.ts:12:4"]
        );
    }

    #[test]
    fn custom_template_rejects_shell_operators_and_variable_expansion() {
        for template in [
            "editor.exe {file} | more",
            "editor.exe {file} > out.txt",
            "editor.exe {file} && calc.exe",
            "editor.exe {file}; calc.exe",
            "editor.exe %TEMP%\\{file}",
            "editor.exe $env:TEMP\\{file}",
            "editor.exe !TEMP!\\{file}",
            "editor.exe `whoami` {file}",
        ] {
            let request = validated_request(EditorId::Custom, template, r"C:\work\a.ts");
            assert!(
                windows_editor_program(&request).is_err(),
                "template should be rejected: {template}"
            );
        }
    }

    #[test]
    fn custom_template_rejects_empty_unbalanced_or_file_derived_executables() {
        for template in ["", r#"""#, "{file} --wait"] {
            let request = validated_request(EditorId::Custom, template, r"C:\work\a.ts");
            assert!(
                windows_editor_program(&request).is_err(),
                "template should be rejected: {template}"
            );
        }
    }

    #[test]
    fn validates_editor_id_template_location_and_canonical_file_independently() {
        let file = fixture_dir().join("src").join("foo.ts");
        let canonical = std::fs::canonicalize(file).unwrap();
        let valid = OpenEditorRequest {
            editor: "vscode".into(),
            template: String::new(),
            file: normalize_canonical_path(&canonical.to_string_lossy()),
            line: 3,
            column: 2,
        };
        assert!(validate_open_editor_request(valid.clone()).is_ok());

        let invalid_editor = OpenEditorRequest {
            editor: "terminal-output".into(),
            ..valid.clone()
        };
        assert!(validate_open_editor_request(invalid_editor).is_err());

        let invalid_template = OpenEditorRequest {
            template: "x".repeat(MAX_EDITOR_TEMPLATE_BYTES + 1),
            ..valid.clone()
        };
        assert!(validate_open_editor_request(invalid_template).is_err());

        let empty_custom = OpenEditorRequest {
            editor: "custom".into(),
            template: "  ".into(),
            ..valid.clone()
        };
        assert!(validate_open_editor_request(empty_custom).is_err());

        let invalid_location = OpenEditorRequest {
            line: 0,
            ..valid.clone()
        };
        assert!(validate_open_editor_request(invalid_location).is_err());

        let invalid_path = OpenEditorRequest {
            file: "relative/file.ts".into(),
            ..valid
        };
        assert!(validate_open_editor_request(invalid_path).is_err());
    }

    #[test]
    fn validate_open_editor_request_rejects_a_unc_file_before_canonicalize() {
        let request = OpenEditorRequest {
            editor: "vscode".into(),
            template: String::new(),
            file: r"\\10.255.255.1\share\file.ts".into(),
            line: 3,
            column: 2,
        };
        let error = validate_open_editor_request(request).unwrap_err();
        // Asserted on the specific message, not just `is_err()`: without the
        // guard this same candidate still ends up an `Err`, just later and
        // for a different reason — `canonicalize` fails on a nonexistent
        // literal filename on this dev host (see `has_rejected_root` in
        // `shell_integration.rs`). The distinct message is what proves the
        // guard, not `canonicalize`, is what stopped it.
        assert_eq!(
            error,
            "The editor file path must not be a network location."
        );
    }

    #[test]
    fn validate_open_editor_request_still_resolves_an_ordinary_file() {
        let file = fixture_dir().join("src").join("foo.ts");
        let canonical = std::fs::canonicalize(file).unwrap();
        let request = OpenEditorRequest {
            editor: "vscode".into(),
            template: String::new(),
            file: normalize_canonical_path(&canonical.to_string_lossy()),
            line: 3,
            column: 2,
        };
        assert!(validate_open_editor_request(request).is_ok());
    }

    #[test]
    fn posix_adapter_quotes_terminal_paths_before_login_shell_launch() {
        let request = validated_request(
            EditorId::Custom,
            "editor --goto {file}:{line}:{col}",
            "/work/it's a file.ts",
        );
        assert_eq!(
            posix_editor_command(&request).unwrap(),
            r#"editor --goto '/work/it'\''s a file.ts':12:4"#
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_direct_launch_reports_success_and_failure() {
        let success = EditorProgram {
            executable: "where.exe".into(),
            args: vec!["cmd.exe".into()],
        };
        assert!(tauri::async_runtime::block_on(run_editor_program(success)).is_ok());

        let missing = EditorProgram {
            executable: "deck-editor-that-does-not-exist.exe".into(),
            args: Vec::new(),
        };
        assert!(tauri::async_runtime::block_on(run_editor_program(missing)).is_err());
    }
}
