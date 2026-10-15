/**
 * @file compiler.ts
 * @module atomis/compiler
 *
 * Thin orchestration layer wiring together the full Atomis pipeline:
 * `lexer → parser → analyzer → transformer → emitter`. Used by the CLI for the
 * `build`, `run`, `check`, `watch`, and `repl` commands.
 */

import { analyze, AnalysisResult } from "./analyzer";
import { emit, EmitResult } from "./emitter";
import { tokenize } from "./lexer";
import { parse, ParseError } from "./parser";
import { validateNames } from "./name-check";
import { transform } from "./transformer";

/** Options for compiling a single source string. */
export interface CompileOptions {
  /** Opt in to strict ES2020/Node TypeScript and regex validation. */
  targetCheck?: boolean;
  /** Logical source file name (used in diagnostics and the source map). */
  fileName: string;
  /** Generated `.ts` output file name (used in the source map). */
  outputFile: string;
  /** Whether to emit a `.ato.map` source map. Default true. */
  sourceMap?: boolean;
}

/** Combined result of compiling Atomis source. */
export interface CompileResult {
  /** Emitted TypeScript code (with sourceMappingURL when source maps on). */
  code: string;
  /** Serialized source map JSON, if produced. */
  map?: string;
  /** Semantic analysis result, including diagnostics. */
  analysis: AnalysisResult;
}

/**
 * Compile Atomis source text to TypeScript.
 * @param source The `.ato` source text.
 * @param options Compile options.
 * @returns The compile result (code + map + diagnostics).
 */
export function compile(source: string, options: CompileOptions): CompileResult {
  if (Buffer.byteLength(source, "utf8") > 8 * 1024 * 1024) throw new ParseError("Source exceeds 8 MiB limit", 1, 1);
  const tokens = tokenize(source);
  const program = parse(tokens, source);
  const analysis = analyze(program);
  if (analysis.hasErrors) return { code: "", analysis };
  const transformed = transform(program);
  const names = validateNames(transformed.code, transformed.mappings);
  if (names.length) return { code: "", analysis: { ...analysis, diagnostics: [...analysis.diagnostics, ...names], hasErrors: true } };

  const mapFileName = baseName(options.outputFile) + ".ato.map";
  const emitted: EmitResult = emit(transformed, {
    sourceFile: options.fileName,
    sourceContent: source,
    outputFile: options.outputFile,
    mapFileName,
    sourceMap: options.sourceMap !== false,
  });

  if (options.targetCheck) {
    const { validateTarget } = require("./target-check") as typeof import("./target-check");
    const diagnostics = validateTarget(emitted.code, options.fileName, transformed.mappings);
    if (diagnostics.length) return { code: "", analysis: { ...analysis, diagnostics: [...analysis.diagnostics, ...diagnostics], hasErrors: true } };
  }

  return {
    code: emitted.code,
    map: emitted.map,
    analysis,
  };
}

/** Return the basename of a path-like string (cross-platform). */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}
