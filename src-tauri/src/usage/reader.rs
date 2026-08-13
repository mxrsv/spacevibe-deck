//! The capped line reader and the hand-rolled RFC3339 parser — the two pieces
//! every other file in `usage` builds on.

/// Largest line the parser will hold in memory.
///
/// The largest Claude line measured on the dev machine is 1.22 MB and the
/// largest Codex line 1.96 MB, so 8 MiB is a guard rather than a routine path.
/// Codex conversation lines are documented to reach ~16 MB and carry no usage
/// at all: past the cap the bytes are consumed to the next newline and thrown
/// away without ever being buffered.
pub(crate) const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;

/// Read granularity. Bigger than the default 8 KiB because a cold scan walks
/// ~2.5 GB of transcripts and the syscall count dominates.
const READ_BUFFER_BYTES: usize = 64 * 1024;

/// What one turn of the reader produced.
pub(crate) enum LineEvent {
    /// A complete line without its newline, and the byte offset just past that
    /// newline — the offset that is safe to commit.
    Line(Vec<u8>, u64),
    /// A complete line longer than the cap. Its bytes were consumed and
    /// discarded; the offset is still safe to commit.
    Oversized(u64),
    /// No further complete line. A partial trailing line stays uncommitted and
    /// is re-read by the next scan.
    End,
}

/// A streaming line reader with a hard per-line byte cap.
///
/// Hand-rolled because `BufRead::read_line` is unbounded — one malformed
/// multi-gigabyte line would be pulled into memory in full — and because
/// `memchr` is a transitive dependency that is not importable (§0.1). The
/// committed offset only ever advances past a newline, which is what makes an
/// interrupted append safe to resume.
pub(crate) struct LineReader<R: std::io::Read> {
    reader: std::io::BufReader<R>,
    /// Byte offset just past the last complete line handed out.
    committed: u64,
    /// Bytes consumed so far, including a partial trailing line.
    consumed: u64,
    cap: usize,
}

impl<R: std::io::Read> LineReader<R> {
    fn build(source: R, start: u64, cap: usize) -> Self {
        Self {
            reader: std::io::BufReader::with_capacity(READ_BUFFER_BYTES, source),
            committed: start,
            consumed: start,
            cap,
        }
    }

    pub(crate) fn new(source: R, start: u64) -> Self {
        Self::build(source, start, MAX_LINE_BYTES)
    }

    /// The cap as a parameter, so the boundary can be proven on eight bytes
    /// instead of allocating eight megabytes in a unit test.
    #[cfg(test)]
    fn with_cap(source: R, start: u64, cap: usize) -> Self {
        Self::build(source, start, cap)
    }

    pub(crate) fn next_line(&mut self) -> std::io::Result<LineEvent> {
        use std::io::BufRead;
        let mut line: Vec<u8> = Vec::new();
        let mut oversized = false;
        loop {
            let available = match self.reader.fill_buf() {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            };
            if available.is_empty() {
                return Ok(LineEvent::End);
            }
            let (taken, newline) = match available.iter().position(|byte| *byte == b'\n') {
                Some(index) => (index + 1, true),
                None => (available.len(), false),
            };
            let payload = if newline { taken - 1 } else { taken };
            if oversized || line.len() + payload > self.cap {
                // Drop what was already held as well: the point of the cap is
                // that an over-long line never occupies memory.
                oversized = true;
                line = Vec::new();
            } else {
                line.extend_from_slice(&available[..payload]);
            }
            self.reader.consume(taken);
            self.consumed += taken as u64;
            if newline {
                self.committed = self.consumed;
                return Ok(if oversized {
                    LineEvent::Oversized(self.committed)
                } else {
                    LineEvent::Line(line, self.committed)
                });
            }
        }
    }
}

/// `YYYY-MM-DDTHH:MM:SS[.fraction]Z` → Unix milliseconds.
///
/// Hand-rolled: `chrono` sits in `Cargo.lock` as a transitive Tauri dependency
/// and is not importable (§0.1), and both CLIs write exactly this shape —
/// Codex `2026-08-10T04:45:59.358Z`, Claude `2026-08-10T05:06:00.351Z`.
/// Anything not ending in `Z` is refused rather than guessed at: silently
/// reading a `+07:00` stamp as UTC would move seven hours of usage onto the
/// wrong local day, which is the exact failure 15-minute buckets exist to
/// prevent. Fractions past three digits are truncated, not rounded.
pub(crate) fn parse_rfc3339_ms(text: &str) -> Option<u64> {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || !text.is_ascii() {
        return None;
    }
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let year = i64::from(digits(&bytes[0..4])?);
    let month = digits(&bytes[5..7])?;
    let day = digits(&bytes[8..10])?;
    let hour = digits(&bytes[11..13])?;
    let minute = digits(&bytes[14..16])?;
    let second = digits(&bytes[17..19])?;
    let millis = fraction_ms(&bytes[19..])?;
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let seconds = days_from_civil(year, month, day)
        .checked_mul(86_400)?
        .checked_add(i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second))?;
    u64::try_from(seconds)
        .ok()?
        .checked_mul(1_000)?
        .checked_add(u64::from(millis))
}

/// An all-ASCII-digit run as a number. `None` on any other byte, so a stray
/// `+` or letter in a fixed field is a refusal rather than a silent zero.
fn digits(bytes: &[u8]) -> Option<u32> {
    let mut value: u32 = 0;
    for byte in bytes {
        if !byte.is_ascii_digit() {
            return None;
        }
        value = value * 10 + u32::from(byte - b'0');
    }
    Some(value)
}

/// The `[.fraction]Z` tail as whole milliseconds.
fn fraction_ms(tail: &[u8]) -> Option<u32> {
    if tail == b"Z" {
        return Some(0);
    }
    if tail.first() != Some(&b'.') || tail.last() != Some(&b'Z') || tail.len() < 3 {
        return None;
    }
    let fraction = &tail[1..tail.len() - 1];
    if !fraction.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let mut millis: u32 = 0;
    for index in 0..3 {
        let digit = fraction
            .get(index)
            .map(|byte| u32::from(byte - b'0'))
            .unwrap_or(0);
        millis = millis * 10 + digit;
    }
    Some(millis)
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Days between 1970-01-01 and the given civil date — Howard Hinnant's
/// `days_from_civil`, which is exact for the whole proleptic Gregorian
/// calendar and needs no table. March is treated as month 0 so the leap day
/// falls at the end of the year and the month-length series becomes the
/// closed form `(153 * m + 2) / 5`.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400; // [0, 399]
    let shifted_month = i64::from((month + 9) % 12); // March = 0
    let day_of_year = (153 * shifted_month + 2) / 5 + i64::from(day) - 1; // [0, 365]
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_all(data: &[u8], start: u64, cap: usize) -> Vec<LineEvent> {
        let mut reader = LineReader::with_cap(std::io::Cursor::new(data.to_vec()), start, cap);
        let mut events = Vec::new();
        loop {
            let event = reader.next_line().expect("cursor reads never fail");
            let done = matches!(event, LineEvent::End);
            events.push(event);
            if done {
                return events;
            }
        }
    }

    fn text(event: &LineEvent) -> Option<String> {
        match event {
            LineEvent::Line(bytes, _) => Some(String::from_utf8_lossy(bytes).into_owned()),
            _ => None,
        }
    }

    #[test]
    fn reads_complete_lines_and_commits_the_offset_past_each_newline() {
        let events = read_all(b"one\ntwo\n", 0, 64);
        assert_eq!(events.len(), 3);
        assert_eq!(text(&events[0]).as_deref(), Some("one"));
        assert_eq!(text(&events[1]).as_deref(), Some("two"));
        assert!(matches!(events[0], LineEvent::Line(_, 4)));
        assert!(matches!(events[1], LineEvent::Line(_, 8)));
        assert!(matches!(events[2], LineEvent::End));
    }

    #[test]
    fn discards_a_partial_trailing_line_without_committing_it() {
        // "two" has no newline: it is not emitted, and the last committed
        // offset stays at 4 so the next scan re-reads it.
        let events = read_all(b"one\ntwo", 0, 64);
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], LineEvent::Line(_, 4)));
        assert!(matches!(events[1], LineEvent::End));
    }

    #[test]
    fn an_empty_line_is_a_line_not_an_end() {
        let events = read_all(b"\na\n", 0, 64);
        assert_eq!(text(&events[0]).as_deref(), Some(""));
        assert_eq!(text(&events[1]).as_deref(), Some("a"));
        assert!(matches!(events[2], LineEvent::End));
    }

    #[test]
    fn keeps_a_line_of_exactly_the_cap_and_skips_one_byte_over() {
        let at_cap = read_all(b"12345678\n", 0, 8);
        assert_eq!(text(&at_cap[0]).as_deref(), Some("12345678"));

        let over_cap = read_all(b"123456789\n", 0, 8);
        assert!(matches!(over_cap[0], LineEvent::Oversized(10)));
    }

    #[test]
    fn skips_an_oversized_line_and_still_reads_the_next_one() {
        let events = read_all(b"123456789\nkept\n", 0, 8);
        assert!(matches!(events[0], LineEvent::Oversized(10)));
        assert_eq!(text(&events[1]).as_deref(), Some("kept"));
        assert!(matches!(events[1], LineEvent::Line(_, 15)));
        assert!(matches!(events[2], LineEvent::End));
    }

    #[test]
    fn an_oversized_line_spanning_several_buffer_fills_is_still_one_event() {
        // Longer than the reader's own buffer, so `fill_buf` returns a chunk
        // with NO newline in it at least twice. That is the "already
        // oversized, keep discarding" branch — the one that must consume and
        // drop bytes instead of appending them. A line that fits in one fill
        // never reaches it.
        let mut data = vec![b'x'; READ_BUFFER_BYTES + 500];
        data.push(b'\n');
        data.extend_from_slice(b"kept\n");
        let expected = (READ_BUFFER_BYTES + 500 + 1) as u64;
        let mut reader = LineReader::with_cap(std::io::Cursor::new(data), 0, 16);
        assert!(matches!(reader.next_line().unwrap(), LineEvent::Oversized(n) if n == expected));
        assert!(matches!(reader.next_line().unwrap(), LineEvent::Line(_, n) if n == expected + 5));
    }

    #[test]
    fn resumes_offsets_from_the_start_it_was_handed() {
        let events = read_all(b"two\n", 4, 64);
        assert!(matches!(events[0], LineEvent::Line(_, 8)));
    }

    #[test]
    fn the_production_cap_is_the_frozen_value() {
        assert_eq!(MAX_LINE_BYTES, 8 * 1024 * 1024);
    }

    #[test]
    fn parses_the_two_timestamp_shapes_both_clis_actually_write() {
        // Codex, verified in rollout-2026-08-10T11-45-40-019fe9fd….jsonl.
        assert_eq!(
            parse_rfc3339_ms("2026-08-10T04:45:59.358Z"),
            Some(1_786_337_159_358)
        );
        // Claude, verified in projects/…/aa8311ee-….jsonl.
        assert_eq!(
            parse_rfc3339_ms("2026-08-10T05:06:00.351Z"),
            Some(1_786_338_360_351)
        );
    }

    #[test]
    fn parses_the_epoch_and_a_leap_day() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            parse_rfc3339_ms("2024-02-29T12:00:00Z"),
            Some(1_709_208_000_000)
        );
        assert_eq!(parse_rfc3339_ms("2023-02-29T12:00:00Z"), None);
    }

    #[test]
    fn truncates_fractional_seconds_past_milliseconds_and_pads_short_ones() {
        assert_eq!(
            parse_rfc3339_ms("2026-08-10T04:45:59.3589999Z"),
            Some(1_786_337_159_358)
        );
        assert_eq!(
            parse_rfc3339_ms("2026-08-10T04:45:59.5Z"),
            Some(1_786_337_159_500)
        );
    }

    #[test]
    fn refuses_anything_that_is_not_zulu_utc() {
        assert_eq!(parse_rfc3339_ms("2026-08-10T04:45:59+07:00"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-10T04:45:59"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-10T04:45:59.358"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-10 04:45:59Z"), None);
        assert_eq!(parse_rfc3339_ms("not a timestamp"), None);
        assert_eq!(parse_rfc3339_ms(""), None);
    }

    #[test]
    fn refuses_out_of_range_fields_and_pre_epoch_dates() {
        assert_eq!(parse_rfc3339_ms("2026-13-01T00:00:00Z"), None);
        assert_eq!(parse_rfc3339_ms("2026-00-01T00:00:00Z"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-32T00:00:00Z"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-10T24:00:00Z"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-10T00:60:00Z"), None);
        // A leap second is legal RFC3339 and never appears in either CLI's
        // output; refusing it beats inventing a mapping onto Unix time.
        assert_eq!(parse_rfc3339_ms("2026-08-10T00:00:60Z"), None);
        assert_eq!(parse_rfc3339_ms("1969-12-31T23:59:59Z"), None);
    }

    #[test]
    fn days_from_civil_matches_the_known_anchors() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(1969, 12, 31), -1);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(2024, 2, 29), 19_782);
        assert!(is_leap_year(2000));
        assert!(!is_leap_year(1900));
        assert!(is_leap_year(2024));
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2023, 2), 28);
        assert_eq!(days_in_month(2026, 8), 31);
        assert_eq!(days_in_month(2026, 4), 30);
    }
}
