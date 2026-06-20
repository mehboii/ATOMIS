//! Thin orchestration layer wiring together the full Atomis pipeline:
//! `lexer → parser → analyzer → transformer → emitter`.
//!
//! Faithful port of `src/compiler.ts`.

use crate::analyzer::{analyze, AnalysisResult};
use crate::emitter::{emit, EmitOptions};
use crate::lexer::tokenize;
use crate::parser::{parse, ParseError};
use crate::transformer::transform;

/// Options for compiling a single source string.
pub struct CompileOptions {
    pub file_name: String,
    pub output_file: String,
    /// Whether to emit a `.ato.map` source map. Default true.
    pub source_map: bool,
}

/// Combined result of compiling Atomis source.
pub struct CompileResult {
    pub code: String,
    pub map: Option<String>,
    pub analysis: AnalysisResult,
}

/// Compile Atomis source text to TypeScript.
pub fn compile(source: &str, options: &CompileOptions) -> Result<CompileResult, ParseError> {
    let tokens = tokenize(source);
    let program = parse(tokens, source)?;
    let analysis = analyze(&program);
    let transformed = transform(&program);

    let map_file_name = format!("{}.ato.map", base_name(&options.output_file));
    let emitted = emit(
        &transformed,
        &EmitOptions {
            source_file: options.file_name.clone(),
            source_content: source.to_string(),
            output_file: options.output_file.clone(),
            map_file_name,
            source_map: options.source_map,
        },
    );

    Ok(CompileResult {
        code: emitted.code,
        map: emitted.map,
        analysis,
    })
}

/// Return the basename of a path-like string (cross-platform).
fn base_name(p: &str) -> String {
    p.rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or(p)
        .to_string()
}
