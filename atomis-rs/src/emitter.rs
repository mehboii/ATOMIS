//! Emits final TypeScript source from a `TransformResult`.
//!
//! Produces Source Map v3 line mappings using Base64 VLQ, matching the
//! TypeScript reference for the tested corpus. Full source spans are not mapped.

use crate::transformer::TransformResult;

/// Options controlling emission.
pub struct EmitOptions {
    pub source_file: String,
    pub source_content: String,
    pub output_file: String,
    pub map_file_name: String,
    pub source_map: bool,
}

/// Result of emission: the TS code and (optionally) the source-map JSON.
pub struct EmitResult {
    pub code: String,
    pub map: Option<String>,
}

pub fn emit(result: &TransformResult, options: &EmitOptions) -> EmitResult {
    let with_source_map = options.source_map;

    let mut code = result.code.clone();
    if !code.ends_with('\n') {
        code.push('\n');
    }

    if !with_source_map {
        return EmitResult { code, map: None };
    }

    code += &format!("//# sourceMappingURL={}\n", options.map_file_name);

    let by_line: std::collections::BTreeMap<usize, usize> = result
        .mappings
        .iter()
        .map(|m| (m.generated_line, m.original_line))
        .collect();
    let max_line = by_line.keys().next_back().copied().unwrap_or(0);
    let mut segments = Vec::new();
    let mut previous = 0i64;
    for generated in 1..=max_line {
        if let Some(original) = by_line.get(&generated) {
            let original = original.saturating_sub(1) as i64;
            segments.push(format!("AA{}A", encode_vlq(original - previous)));
            previous = original;
        } else {
            segments.push(String::new());
        }
    }
    let base = |p: &str| p.rsplit(['/', '\\']).next().unwrap_or(p).to_string();
    let quote = crate::util::json_string;
    let map = format!(
        "{{\"version\":3,\"file\":{},\"sources\":[{}],\"sourcesContent\":[{}],\"names\":[],\"mappings\":{}}}",
        quote(&base(&options.output_file)), quote(&base(&options.source_file)),
        quote(&options.source_content), quote(&segments.join(";")));
    EmitResult {
        code,
        map: Some(map),
    }
}

/// Base64 VLQ for signed line deltas, including backwards mappings.
pub fn encode_vlq(value: i64) -> String {
    const BASE64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut vlq = (u128::from(value.unsigned_abs()) << 1) | u128::from(value < 0);
    let mut out = String::new();
    loop {
        let mut digit = (vlq & 31) as usize;
        vlq >>= 5;
        if vlq > 0 {
            digit |= 32;
        }
        out.push(BASE64[digit] as char);
        if vlq == 0 {
            break;
        }
    }
    out
}
