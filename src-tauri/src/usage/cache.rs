//! The on-disk cache: load with a version guard, write atomically.

use super::{UsageCache, CACHE_TEMP_SUFFIX, USAGE_CACHE_VERSION};
use std::path::{Path, PathBuf};

/// The cache from disk, or an empty one.
///
/// Every failure path — no path, unreadable file, unparseable JSON, a version
/// this build does not understand — returns an empty cache, which makes the
/// next scan a full rescan. That is slow exactly once and always correct;
/// half-trusting a cache this build cannot interpret is neither.
pub(crate) fn load_cache(path: Option<&Path>) -> UsageCache {
    let Some(path) = path else {
        return UsageCache::default();
    };
    let Ok(bytes) = std::fs::read(path) else {
        return UsageCache::default();
    };
    let Ok(cache) = serde_json::from_slice::<UsageCache>(&bytes) else {
        return UsageCache::default();
    };
    if cache.cache_version != USAGE_CACHE_VERSION {
        return UsageCache::default();
    }
    cache
}

/// Write the cache atomically: same-directory temp file, then rename.
///
/// The rename is what makes it atomic — a same-filesystem rename either
/// happens or does not, so a reader never sees a half-written cache. Writing
/// in place would leave unparseable JSON behind on a crash, and the loader
/// would then throw away a cache describing gigabytes of already-scanned
/// transcripts.
pub(crate) fn write_cache(path: &Path, cache: &UsageCache) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec(cache).map_err(std::io::Error::other)?;
    let mut temp = path.as_os_str().to_os_string();
    temp.push(CACHE_TEMP_SUFFIX);
    let temp = PathBuf::from(temp);
    std::fs::write(&temp, &bytes)?;
    if let Err(error) = std::fs::rename(&temp, path) {
        // Never leave the temp file behind: it would be mistaken for a cache
        // by nothing, but it would grow one stale copy per failed write.
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::usage::{FileRecord, UsageAgent, USAGE_CACHE_FILE};
    use std::collections::BTreeMap;

    /// A throwaway tree under the OS temp dir. No `tempfile` dev-dependency:
    /// this feature ships zero new crates, test-only included. Same shape as
    /// `prompt_assets.rs:512-517`, with the process id so two `cargo test`
    /// runs cannot collide.
    pub(crate) fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deck-usage-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_cache() -> UsageCache {
        let mut files = BTreeMap::new();
        files.insert(
            "/tmp/a.jsonl".to_string(),
            FileRecord::empty(UsageAgent::Codex, "019fe9fd".into(), 1_000, 2_000),
        );
        UsageCache {
            cache_version: USAGE_CACHE_VERSION,
            files,
        }
    }

    #[test]
    fn writes_the_cache_through_a_temp_file_and_leaves_none_behind() {
        let dir = fixture("cache-write");
        let path = dir.join(USAGE_CACHE_FILE);
        write_cache(&path, &sample_cache()).unwrap();

        assert_eq!(load_cache(Some(&path)), sample_cache());
        let temp = dir.join(format!("{USAGE_CACHE_FILE}{CACHE_TEMP_SUFFIX}"));
        assert!(!temp.exists(), "the temp file must not survive the rename");

        // A second write replaces the first rather than failing on an
        // existing destination.
        let mut grown = sample_cache();
        grown.files.insert(
            "/tmp/b.jsonl".to_string(),
            FileRecord::empty(UsageAgent::Claude, "sess-2".into(), 3, 4),
        );
        write_cache(&path, &grown).unwrap();
        assert_eq!(load_cache(Some(&path)), grown);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_the_cache_directory_when_it_does_not_exist_yet() {
        let dir = fixture("cache-mkdir");
        let path = dir.join("nested").join("deeper").join(USAGE_CACHE_FILE);
        write_cache(&path, &sample_cache()).unwrap();
        assert!(path.is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discards_a_cache_written_by_another_parser_version() {
        let dir = fixture("cache-version");
        let path = dir.join(USAGE_CACHE_FILE);
        let stale = UsageCache {
            cache_version: USAGE_CACHE_VERSION + 1,
            ..sample_cache()
        };
        std::fs::write(&path, serde_json::to_vec(&stale).unwrap()).unwrap();

        let loaded = load_cache(Some(&path));
        assert!(
            loaded.files.is_empty(),
            "a version mismatch forces a full rescan"
        );
        assert_eq!(loaded.cache_version, USAGE_CACHE_VERSION);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discards_unparseable_or_missing_cache_bytes() {
        let dir = fixture("cache-garbage");
        let path = dir.join(USAGE_CACHE_FILE);
        std::fs::write(&path, b"{ half a file").unwrap();
        assert_eq!(load_cache(Some(&path)), UsageCache::default());
        assert_eq!(
            load_cache(Some(&dir.join("nothing-here.json"))),
            UsageCache::default()
        );
        assert_eq!(load_cache(None), UsageCache::default());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
