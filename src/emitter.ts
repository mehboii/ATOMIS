/**
 * @file emitter.ts
 * @module atomis/emitter
 *
 * Emits final TypeScript source from a {@link TransformResult} and produces a
 * companion Source Map v3 (`.ato.map`) that maps each generated line back to
 * the original `.ato` source line.
 *
 * The transformer already produced clean TS text and a per-line mapping; the
 * emitter's job is to:
 *  - append a `//# sourceMappingURL=...` comment,
 *  - encode the line mapping into a valid VLQ source-map `mappings` string,
 *  - and assemble the JSON source map document.
 */

import * as path from "path";
import { LineMapping, TransformResult } from "./transformer";

/** Options controlling emission. */
export interface EmitOptions {
  /** Path (or name) of the original `.ato` source, recorded in the map. */
  sourceFile: string;
  /** Original source text, embedded as `sourcesContent`. */
  sourceContent: string;
  /** Name of the generated `.ts` file (recorded as map `file`). */
  outputFile: string;
  /** File name to reference in the `sourceMappingURL` comment. */
  mapFileName: string;
  /** When false, no source-map comment or map document is produced. */
  sourceMap?: boolean;
}

/** Result of emission: the TS code and (optionally) the source-map JSON. */
export interface EmitResult {
  /** Final TypeScript source, including the sourceMappingURL comment. */
  code: string;
  /** Serialized source-map JSON, or `undefined` when source maps are off. */
  map?: string;
}

/**
 * Emit final TypeScript and an optional source map.
 * @param result The transform result.
 * @param options Emission options.
 * @returns The emitted code and map.
 */
export function emit(result: TransformResult, options: EmitOptions): EmitResult {
  const withSourceMap = options.sourceMap !== false;

  let code = result.code;
  if (!code.endsWith("\n")) code += "\n";

  if (!withSourceMap) {
    return { code };
  }

  code += `//# sourceMappingURL=${options.mapFileName}\n`;

  const map = buildSourceMap(result.mappings, {
    file: path.basename(options.outputFile),
    source: path.basename(options.sourceFile),
    sourceContent: options.sourceContent,
  });

  return { code, map: JSON.stringify(map) };
}

/** Internal shape of a Source Map v3 document. */
interface SourceMapV3 {
  version: 3;
  file: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

/**
 * Build a Source Map v3 document from line mappings. Each generated line is
 * mapped (at column 0) to its original line (at column 0). The original-line
 * field is delta-encoded across generated lines per the spec.
 */
function buildSourceMap(
  mappings: LineMapping[],
  meta: { file: string; source: string; sourceContent: string },
): SourceMapV3 {
  // Index mappings by generated line for O(1) lookup.
  const byGenerated = new Map<number, number>();
  let maxGenerated = 0;
  for (const m of mappings) {
    byGenerated.set(m.generatedLine, m.originalLine);
    if (m.generatedLine > maxGenerated) maxGenerated = m.generatedLine;
  }

  const segments: string[] = [];
  let prevOriginalLine = 0; // 0-based, delta-encoded across lines
  for (let gen = 1; gen <= maxGenerated; gen++) {
    const original = byGenerated.get(gen);
    if (original === undefined) {
      segments.push(""); // unmapped generated line
      continue;
    }
    const origLine0 = Math.max(0, original - 1);
    // Segment fields: [generatedColumn, sourceIndex, originalLine, originalColumn]
    const seg = [0, 0, origLine0 - prevOriginalLine, 0];
    prevOriginalLine = origLine0;
    segments.push(seg.map(encodeVlq).join(""));
  }

  return {
    version: 3,
    file: meta.file,
    sources: [meta.source],
    sourcesContent: [meta.sourceContent],
    names: [],
    mappings: segments.join(";"),
  };
}

/** Base64 alphabet used by VLQ encoding. */
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Encode a single integer using Base64 VLQ (the encoding used by source maps).
 * @param value The integer to encode (may be negative).
 * @returns The Base64-VLQ string.
 */
export function encodeVlq(value: number): string {
  // Move the sign to the least-significant bit.
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = vlq & 0b11111;
    vlq >>>= 5;
    if (vlq > 0) digit |= 0b100000; // continuation bit
    out += BASE64[digit];
  } while (vlq > 0);
  return out;
}
