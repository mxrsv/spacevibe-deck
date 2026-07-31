use crate::platform::{validate_user_home, ShellLaunch};
use std::path::PathBuf;
use std::sync::OnceLock;

trait WindowsShellProvider {
    fn user_profile(&self) -> Option<PathBuf>;
    fn find_executable(&self, name: &str) -> Option<PathBuf>;
}

struct SystemWindowsShellProvider;

const POWERSHELL_CANDIDATES: [&str; 2] = ["pwsh.exe", "powershell.exe"];

const PROMPT_INTEGRATION: &str = r#"$Global:__DeckOriginalPrompt = $function:Prompt;
function Global:prompt {
  $loc = $executionContext.SessionState.Path.CurrentLocation;
  $out = "$([char]27)]133;A$([char]7)";
  if ($loc.Provider.Name -eq "FileSystem") {
    $out += "$([char]27)]9;9;`"$($loc.ProviderPath)`"$([char]7)";
  }
  if ($null -ne $Global:__DeckOriginalPrompt) {
    $out += $Global:__DeckOriginalPrompt.Invoke();
  } else {
    $out += "PS $loc$('>' * ($nestedPromptLevel + 1)) ";
  }
  $out += "$([char]27)]133;B$([char]7)";
  return $out;
}"#;

static USER_HOME: OnceLock<Result<PathBuf, String>> = OnceLock::new();

impl WindowsShellProvider for SystemWindowsShellProvider {
    fn user_profile(&self) -> Option<PathBuf> {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }

    fn find_executable(&self, name: &str) -> Option<PathBuf> {
        executable_candidates(name)
            .into_iter()
            .find(|candidate| candidate.is_absolute() && candidate.is_file())
    }
}

fn executable_candidates(name: &str) -> Vec<PathBuf> {
    let mut candidates = std::env::var_os("PATH")
        .map(|value| {
            std::env::split_paths(&value)
                .map(|directory| directory.join(name))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if name.eq_ignore_ascii_case("pwsh.exe") {
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            candidates.push(
                PathBuf::from(program_files)
                    .join("PowerShell")
                    .join("7")
                    .join(name),
            );
        }
    } else if name.eq_ignore_ascii_case("powershell.exe") {
        if let Some(system_root) = std::env::var_os("SystemRoot") {
            candidates.push(
                PathBuf::from(system_root)
                    .join("System32")
                    .join("WindowsPowerShell")
                    .join("v1.0")
                    .join(name),
            );
        }
    }
    candidates
}

fn resolve_user_home(provider: &impl WindowsShellProvider) -> Result<PathBuf, String> {
    let profile = provider
        .user_profile()
        .ok_or_else(|| "The Windows user profile directory is unavailable".to_string())?;
    validate_user_home(profile)
        .map_err(|error| format!("The Windows user profile directory is invalid: {error}"))
}

fn build_shell_launch(provider: &impl WindowsShellProvider) -> Result<ShellLaunch, String> {
    let executable = POWERSHELL_CANDIDATES
        .iter()
        .filter_map(|name| provider.find_executable(name))
        .find(|path| path.is_absolute() && path.is_file())
        .ok_or_else(|| {
            "No supported PowerShell executable was found. Install PowerShell 7 or enable Windows PowerShell."
                .to_string()
        })?;

    Ok(ShellLaunch::new(
        executable.to_string_lossy(),
        vec![
            "-NoLogo".into(),
            "-NoExit".into(),
            "-Command".into(),
            PROMPT_INTEGRATION.into(),
        ],
    ))
}

pub(super) fn user_home() -> Result<PathBuf, String> {
    USER_HOME
        .get_or_init(|| resolve_user_home(&SystemWindowsShellProvider))
        .clone()
}

pub(super) fn shell_launch() -> Result<ShellLaunch, String> {
    build_shell_launch(&SystemWindowsShellProvider)
}

#[cfg(test)]
mod tests {
    use super::{build_shell_launch, resolve_user_home, WindowsShellProvider};
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

    struct FixtureProvider {
        profile: Option<PathBuf>,
        executables: HashMap<String, PathBuf>,
    }

    impl FixtureProvider {
        fn new(profile: Option<PathBuf>) -> Self {
            Self {
                profile,
                executables: HashMap::new(),
            }
        }

        fn with_executable(mut self, name: &str, path: PathBuf) -> Self {
            self.executables.insert(name.to_string(), path);
            self
        }
    }

    impl WindowsShellProvider for FixtureProvider {
        fn user_profile(&self) -> Option<PathBuf> {
            self.profile.clone()
        }

        fn find_executable(&self, name: &str) -> Option<PathBuf> {
            self.executables.get(name).cloned()
        }
    }

    fn fixture_dir() -> PathBuf {
        let directory = std::env::temp_dir().join("deck-windows-shell-test");
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn fixture_executable(name: &str) -> PathBuf {
        let path = fixture_dir().join(name);
        std::fs::write(&path, "fixture").unwrap();
        path
    }

    #[test]
    fn selects_pwsh_before_windows_powershell() {
        let pwsh = fixture_executable("pwsh.exe");
        let powershell = fixture_executable("powershell.exe");
        let provider = FixtureProvider::new(Some(fixture_dir()))
            .with_executable("pwsh.exe", pwsh.clone())
            .with_executable("powershell.exe", powershell);

        assert_eq!(
            build_shell_launch(&provider).unwrap().executable,
            pwsh.to_string_lossy()
        );
    }

    #[test]
    fn falls_back_to_windows_powershell() {
        let powershell = fixture_executable("powershell.exe");
        let provider = FixtureProvider::new(Some(fixture_dir()))
            .with_executable("powershell.exe", powershell.clone());

        assert_eq!(
            build_shell_launch(&provider).unwrap().executable,
            powershell.to_string_lossy()
        );
    }

    #[test]
    fn ignores_shell_on_windows() {
        let git_bash = fixture_executable("bash.exe");
        let powershell = fixture_executable("powershell.exe");
        let provider = FixtureProvider::new(Some(fixture_dir()))
            .with_executable("SHELL", git_bash)
            .with_executable("powershell.exe", powershell.clone());

        assert_eq!(
            build_shell_launch(&provider).unwrap().executable,
            powershell.to_string_lossy()
        );
    }

    #[test]
    fn rejects_relative_or_missing_user_profile() {
        let relative = FixtureProvider::new(Some(PathBuf::from("relative/profile")));
        let missing =
            FixtureProvider::new(Some(fixture_dir().join("missing-user-profile-for-test")));

        assert!(resolve_user_home(&relative).is_err());
        assert!(resolve_user_home(&missing).is_err());
    }

    #[test]
    fn builds_profile_loading_prompt_integration() {
        let powershell = fixture_executable("powershell.exe");
        let provider =
            FixtureProvider::new(Some(fixture_dir())).with_executable("powershell.exe", powershell);

        let launch = build_shell_launch(&provider).unwrap();
        let script = launch.args.last().unwrap();

        assert!(!launch
            .args
            .iter()
            .any(|arg| arg == concat!("-No", "Profile")));
        assert!(launch.args.iter().any(|arg| arg == "-NoExit"));
        assert!(script.contains("$function:Prompt"));
        // `e is PowerShell 6.0+. Windows PowerShell 5.1 drops the backtick and
        // keeps a literal "e", so every prompt line would render the escape as
        // text and no OSC sequence would ever reach the parser. $([char]27) is
        // valid in both hosts — exactly as $([char]7) already is on these lines.
        assert!(!script.contains("`e"), "PowerShell 5.1 cannot parse `e");
        assert!(script.contains("$([char]27)]133;A"));
        assert!(script.contains("$([char]27)]133;B"));
        assert!(script.contains("$([char]27)]9;9;"));
        assert!(!script.contains(concat!("Set-", "Content")));
        assert!(!script.contains(concat!("Add-", "Content")));
    }

    #[test]
    fn rejects_non_absolute_or_missing_executables() {
        let relative = FixtureProvider::new(Some(fixture_dir()))
            .with_executable("pwsh.exe", PathBuf::from("pwsh.exe"));
        let missing = FixtureProvider::new(Some(fixture_dir()))
            .with_executable("pwsh.exe", fixture_dir().join("missing-pwsh.exe"));

        assert!(build_shell_launch(&relative).is_err());
        assert!(build_shell_launch(&missing).is_err());
    }

    #[test]
    fn executable_fixture_is_absolute_and_existing() {
        let executable = fixture_executable("fixture.exe");

        assert!(executable.is_absolute());
        assert!(Path::new(&executable).is_file());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn resolves_the_real_windows_shell_environment() {
        let home = super::user_home().expect("Windows must expose a valid user profile");
        let launch = super::shell_launch().expect("Windows must expose a supported PowerShell");

        assert!(home.is_absolute());
        assert!(home.is_dir());
        assert!(Path::new(&launch.executable).is_absolute());
        assert!(Path::new(&launch.executable).is_file());
    }

    // `builds_profile_loading_prompt_integration` above only substring-matches
    // the Rust literal, which mutation testing showed cannot distinguish a
    // working prompt from one whose `function Global:prompt` was renamed (the
    // exact shape of audit finding A1: no OSC sequence ever reaches the
    // parser). These tests instead run PROMPT_INTEGRATION under a real
    // PowerShell host and inspect the bytes it actually emits.

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_powershell_prompt_emits_a_real_escape_byte() {
        // Windows PowerShell 5.1 is the host that could not parse `e — it
        // must be present on any Windows box, so a missing executable here
        // is itself a real failure, not something to skip.
        let output = spawn_prompt_probe("powershell.exe")
            .expect("Windows PowerShell 5.1 must exist on a Windows host");
        assert_prompt_emits_escape_sequence(output, "powershell.exe");

        // PowerShell 7 is optional on a given box. When it is installed,
        // assert the same result so the test proves both supported hosts;
        // when it is not, skip that half rather than failing on its absence.
        match spawn_prompt_probe("pwsh.exe") {
            Ok(output) => assert_prompt_emits_escape_sequence(output, "pwsh.exe"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => panic!("failed to launch pwsh.exe: {error}"),
        }
    }

    #[cfg(target_os = "windows")]
    fn spawn_prompt_probe(shell_exe: &str) -> std::io::Result<std::process::Output> {
        // `prompt` is the well-known function name PowerShell's host calls to
        // render each prompt line; calling it directly after the script
        // defines `Global:prompt` invokes exactly that function, the same as
        // an interactive host would. Casting the returned string through
        // `char[]` to `int[]` gives Unicode code points, so a leading escape
        // byte is unambiguous in the captured stdout instead of being eaten
        // by terminal interpretation.
        let probe = format!(
            "{}\n[int[]][char[]](prompt) -join ','",
            super::PROMPT_INTEGRATION
        );
        // Production passes PROMPT_INTEGRATION the same way — a multi-line
        // string as a single `-Command` argument (see `build_shell_launch`).
        // `std::process::Command` quotes it into one Windows command-line
        // argument, and PowerShell's own parser treats embedded newlines as
        // statement separators just like `;`, so this is reliable.
        //
        // `-NoProfile` here (production omits it) is safe: the engine
        // predefines a default `prompt` function before any profile ever
        // runs, so `$function:Prompt` is never null and the script still
        // exercises the same "existing prompt" branch production hits in
        // practice. Using it makes the probe hermetic — without it, a stray
        // `Write-Host`/`Write-Output` in a CI runner's profile script would
        // land on the same stdout we parse as comma-separated integers and
        // could break the test for reasons unrelated to PROMPT_INTEGRATION.
        std::process::Command::new(shell_exe)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &probe,
            ])
            .output()
    }

    #[cfg(target_os = "windows")]
    fn assert_prompt_emits_escape_sequence(output: std::process::Output, shell_exe: &str) {
        assert!(
            output.status.success(),
            "prompt script failed to parse under {shell_exe}: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let stdout = String::from_utf8_lossy(&output.stdout);
        let codes: Vec<i64> = stdout
            .trim()
            .split(',')
            .filter_map(|value| value.trim().parse().ok())
            .collect();

        assert!(
            !codes.is_empty(),
            "{shell_exe}: prompt returned nothing; stdout was {stdout:?}"
        );
        assert_eq!(
            codes.first().copied(),
            Some(27),
            "{shell_exe}: first byte must be ESC (27). 101 would mean the `e \
             escape regressed and the prompt renders as literal text \
             instead — audit finding A1."
        );

        // A lone leading ESC does not prove the OSC 133;A marker survived
        // intact — check the full opening sequence as code points:
        // ESC ] 1 3 3 ; A BEL.
        let opening: Vec<i64> = codes.iter().take(8).copied().collect();
        assert_eq!(
            opening,
            vec![27, 93, 49, 51, 51, 59, 65, 7],
            "{shell_exe}: OSC 133;A opening marker is missing or malformed: {codes:?}"
        );
    }
}
