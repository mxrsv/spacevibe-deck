pub(crate) fn parse_windows_command_line(command_line: &str) -> Result<Vec<String>, String> {
    let chars: Vec<char> = command_line.chars().collect();
    let mut args = Vec::new();
    let mut cursor = 0;

    while cursor < chars.len() {
        while cursor < chars.len() && chars[cursor].is_whitespace() {
            cursor += 1;
        }
        if cursor == chars.len() {
            break;
        }

        let mut arg = String::new();
        let mut quoted = false;
        while cursor < chars.len() {
            match chars[cursor] {
                '\\' => {
                    let start = cursor;
                    while cursor < chars.len() && chars[cursor] == '\\' {
                        cursor += 1;
                    }
                    let slash_count = cursor - start;
                    if cursor < chars.len() && chars[cursor] == '"' {
                        arg.extend(std::iter::repeat_n('\\', slash_count / 2));
                        if slash_count % 2 == 1 {
                            arg.push('"');
                            cursor += 1;
                        } else {
                            quoted = !quoted;
                            cursor += 1;
                        }
                    } else {
                        arg.extend(std::iter::repeat_n('\\', slash_count));
                    }
                }
                '"' if quoted && chars.get(cursor + 1) == Some(&'"') => {
                    arg.push('"');
                    cursor += 2;
                }
                '"' => {
                    quoted = !quoted;
                    cursor += 1;
                }
                character if character.is_whitespace() && !quoted => break,
                character => {
                    arg.push(character);
                    cursor += 1;
                }
            }
        }
        if quoted {
            return Err("The custom editor command has an unterminated quote.".into());
        }
        args.push(arg);
    }

    Ok(args)
}

pub(super) fn split_windows_command_line(command_line: &str) -> Vec<String> {
    parse_windows_command_line(command_line).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{parse_windows_command_line, split_windows_command_line};

    #[test]
    fn parses_quoted_windows_arguments() {
        assert_eq!(
            split_windows_command_line(
                r#""C:\Program Files\node.exe" "C:\Users\dev\node_modules\@openai\codex\bin\codex.js" --quiet"#,
            ),
            vec![
                r"C:\Program Files\node.exe",
                r"C:\Users\dev\node_modules\@openai\codex\bin\codex.js",
                "--quiet",
            ]
        );
    }

    #[test]
    fn preserves_escaped_quotes_and_backslashes() {
        assert_eq!(
            split_windows_command_line(r#"node.exe "say \"hello\"" C:\work\\"#),
            vec!["node.exe", r#"say "hello""#, r"C:\work\\"]
        );
    }

    #[test]
    fn keeps_empty_quoted_arguments() {
        assert_eq!(
            split_windows_command_line(r#"pwsh.exe -Command "" tail"#),
            vec!["pwsh.exe", "-Command", "", "tail"]
        );
    }

    #[test]
    fn checked_parser_rejects_an_unterminated_quote() {
        assert!(parse_windows_command_line(r#""C:\Program Files\editor.exe"#).is_err());
    }
}
