//! Small shared utilities.

/// Faithful reimplementation of JavaScript's `JSON.stringify(string)` for a
/// single string value. Used wherever the TS reference quotes bare identifiers
/// / ids / transports (parser `renderConfigValue`, transformer GhostNet emit).
///
/// Wraps the input in double quotes and escapes per the JSON spec; control
/// characters below 0x20 without a short escape become `\u00XX`. Non-ASCII
/// characters are passed through unchanged, matching V8's behaviour.
pub fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
