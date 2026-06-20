//! Emits final TypeScript source from a `TransformResult`.
//!
//! Faithful port of `src/emitter.ts`, with one scoped omission: the VLQ
//! Source Map v3 document (`.ato.map`) is intentionally NOT generated yet — see
//! the parity decision. The `//# sourceMappingURL=...` comment IS still appended
//! when source maps are enabled, so the emitted `.ts` stays byte-identical to the
//! TS reference. `buildSourceMap` is left as a documented hook below.

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

    // HOOK (out of scope for this port): build the VLQ Source Map v3 here from
    // `result.mappings`, using `options.source_file` / `options.source_content`
    // / `options.output_file`. The TS reference's `buildSourceMap` + `encodeVlq`
    // can be ported 1:1 when source maps are reinstated. Returning `None` does
    // not affect the emitted `.ts` bytes (only the companion `.ato.map` file).
    let _ = (&options.source_file, &options.source_content, &options.output_file);

    EmitResult { code, map: None }
}
