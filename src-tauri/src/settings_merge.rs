//! Settings writes that survive two windows editing at once (spec §9.5).
//!
//! `updateSettings` read the whole object from its own signal, changed one key
//! and wrote the whole object back. With peer windows that is a lost update:
//! whoever writes second overwrites the other's change with a value it read
//! before that change existed. The fix is to send the change, not the result —
//! Rust holds the only lock and every window learns the merged value.
//!
//! `onKeyChange` was considered and rejected: it announces that a write
//! happened, which does not stop two read-modify-write cycles from racing.

use serde_json::{Map, Value};
use std::sync::Mutex;
use tauri::{Emitter, State};
use tauri_plugin_store::StoreExt;

/// Mirrors `src/settings/settings-store.ts` — same file, same key.
const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "settings";

/// Serializes read-modify-write. The store's own lock covers a single `get` or
/// `set`, not the sequence, which is exactly the window that loses an update.
#[derive(Default)]
pub struct SettingsWriteLock(Mutex<()>);

/// Shallow merge: a patch's top-level keys replace their values outright,
/// matching `{ ...settings.value, ...patch }` on the TypeScript side. A patch
/// that is not an object is ignored rather than allowed to replace everything.
pub fn merge_settings(current: &Value, patch: &Value) -> Value {
    let Some(patch) = patch.as_object() else {
        return current.clone();
    };
    let mut merged: Map<String, Value> = current.as_object().cloned().unwrap_or_else(Map::new);
    for (key, value) in patch {
        merged.insert(key.clone(), value.clone());
    }
    Value::Object(merged)
}

/// Merge `patch` into the stored settings and tell every window the result.
#[tauri::command]
pub fn apply_settings_patch(
    app: tauri::AppHandle,
    lock: State<'_, SettingsWriteLock>,
    patch: Value,
) -> Result<Value, String> {
    let guard = lock
        .0
        .lock()
        .map_err(|_| "The settings lock is poisoned".to_string())?;

    let store = app.store(STORE_FILE).map_err(|error| error.to_string())?;
    let current = store.get(STORE_KEY).unwrap_or(Value::Null);
    let merged = merge_settings(&current, &patch);
    store.set(STORE_KEY, merged.clone());
    // Explicit save, not the autosave timer: the plugin discards the timer's
    // error, which is how a full disk used to look like a successful write.
    store.save().map_err(|error| error.to_string())?;
    drop(guard);

    // The one correct broadcast in this module: every window holds a copy of
    // settings and every copy must converge.
    let _ = app.emit("settings:merged", merged.clone());
    Ok(merged)
}

#[cfg(test)]
mod tests {
    use super::merge_settings;
    use serde_json::json;

    #[test]
    fn a_patch_replaces_only_the_keys_it_names() {
        let current =
            json!({ "fontSize": 13, "theme": "night", "colorOverrides": { "red": "#f00" } });
        let patch = json!({ "fontSize": 15 });

        assert_eq!(
            merge_settings(&current, &patch),
            json!({ "fontSize": 15, "theme": "night", "colorOverrides": { "red": "#f00" } })
        );
    }

    #[test]
    fn two_patches_touching_different_keys_both_survive() {
        // The whole point: window A changing the font must not undo window B
        // changing the theme.
        let current = json!({ "fontSize": 13, "theme": "night" });
        let after_a = merge_settings(&current, &json!({ "fontSize": 15 }));
        let after_b = merge_settings(&after_a, &json!({ "theme": "dawn" }));

        assert_eq!(after_b, json!({ "fontSize": 15, "theme": "dawn" }));
    }

    #[test]
    fn a_nested_object_is_replaced_wholesale_not_deep_merged() {
        // Shallow on purpose: it mirrors `updateSettings`'s spread, so a caller
        // that clears one color override still clears it.
        let current = json!({ "colorOverrides": { "red": "#f00", "blue": "#00f" } });
        let patch = json!({ "colorOverrides": { "red": "#a00" } });

        assert_eq!(
            merge_settings(&current, &patch),
            json!({ "colorOverrides": { "red": "#a00" } })
        );
    }

    #[test]
    fn a_null_value_is_stored_not_treated_as_a_deletion() {
        let current = json!({ "logo": "deck" });
        assert_eq!(
            merge_settings(&current, &json!({ "logo": null })),
            json!({ "logo": null })
        );
    }

    #[test]
    fn a_non_object_current_starts_from_an_empty_object() {
        assert_eq!(
            merge_settings(&json!(null), &json!({ "fontSize": 15 })),
            json!({ "fontSize": 15 })
        );
    }

    #[test]
    fn a_non_object_patch_leaves_the_settings_untouched() {
        let current = json!({ "fontSize": 13 });
        assert_eq!(merge_settings(&current, &json!("nonsense")), current);
        assert_eq!(merge_settings(&current, &json!([1, 2])), current);
    }
}
