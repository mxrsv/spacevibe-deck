use std::fs;
use std::io;
use std::path::Path;
use tauri::Manager;

/// The bundle identifier the app shipped under before the rename (ADR 0028).
const LEGACY_IDENTIFIER: &str = "com.kyantran.stackgrid";

/// Carry an existing install's stored state across the identifier change.
///
/// The app data directory is keyed by the bundle identifier, so
/// `com.kyantran.stackgrid` → `dev.spacevibe.deck` reads to anyone who already
/// had the app installed as a factory reset: theme, layout presets, workspace
/// recents and logos all appear to vanish at once.
///
/// Copies rather than moves, and only when the new directory does not exist
/// yet — so it runs exactly once, and a user who downgrades to 0.7.x still
/// finds their settings where that build looks for them. Every failure is
/// non-fatal: starting with defaults beats refusing to launch.
pub fn legacy_app_data<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Ok(current) = app.path().app_data_dir() else {
        return;
    };
    // Anything already there means the migration ran before, or this install
    // has since written its own state. Either way it is not ours to overwrite.
    if current.exists() {
        return;
    }
    let Some(legacy) = current.parent().map(|dir| dir.join(LEGACY_IDENTIFIER)) else {
        return;
    };
    if !legacy.is_dir() {
        return;
    }
    if let Err(err) = copy_dir(&legacy, &current) {
        // Leave nothing half-copied: a partial directory reads as "already
        // migrated" on the next launch and would strand whatever is missing.
        let _ = fs::remove_dir_all(&current);
        eprintln!("settings migration from {LEGACY_IDENTIFIER} failed: {err}");
    }
}

/// Recursive copy of `from` into `to`, creating `to` and its parents.
fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::copy_dir;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deck-migrate-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn copies_nested_files_and_leaves_the_source_intact() {
        let root = scratch("nested");
        let from = root.join("from");
        let to = root.join("to");
        fs::create_dir_all(from.join("sub")).unwrap();
        fs::write(from.join("settings.json"), b"{\"theme\":\"dracula\"}").unwrap();
        fs::write(from.join("sub").join("logo.json"), b"[]").unwrap();

        copy_dir(&from, &to).unwrap();

        assert_eq!(
            fs::read(to.join("settings.json")).unwrap(),
            b"{\"theme\":\"dracula\"}"
        );
        assert_eq!(fs::read(to.join("sub").join("logo.json")).unwrap(), b"[]");
        // A downgrade to 0.7.x has to still find its own settings.
        assert!(from.join("settings.json").exists());

        let _ = fs::remove_dir_all(&root);
    }
}
