/**
 * @file transformer.ts
 * @module atomis/transformer
 *
 * Transforms an Atomis {@link Program} AST into TypeScript source.
 *
 * Rather than building a second (TypeScript) AST, the transformer emits clean,
 * canonically-formatted TypeScript text together with a line-level mapping back
 * to the original `.ato` source. The {@link Emitter} consumes this mapping to
 * write `.ts` files and `.ato.map` source maps.
 *
 * Transformation rules implemented (per the Atomis spec):
 *  - `atom x: T = v`            → `let x: T = v`  (atom recorded for reactivity)
 *  - `fn f(p) -> T { }`         → `function f(p): T { }`
 *  - `pure fn`                  → function with a `@pure` JSDoc marker
 *  - `match e { p => r, _ => r }` → if/else-if/else chain
 *  - `guard c else { b }`       → `if (!(c)) { b }`
 *  - `Result<T,E>` / `Ok` / `Err` → handled lexically inside passthrough
 *  - `@import { x } from "m"`   → `import { x } from "m"`
 *  - `@cell #n ...`             → `__atomis_cell("n", async () => { ... })`
 *  - `@render { view N { JSX } }` → JSX component function
 *  - `output(x)`                → `console.log(x)`
 *  - `node "id" { ... }`        → `const __id = new GhostNode({ id, ...cfg })`
 *  - `channel "id" { ... }`     → `new GhostChannel(...)`
 *  - `mesh "id" { ... }`        → `new GhostMesh(...)`
 *  - `connect "c" -> "n" via t` → `__c.connect(__n, "t")`
 *  - `encrypt { ... }`          → `setEncryptionPolicy({ ... })`
 */

import {
  AtomDecl,
  CellBlock,
  ChannelDecl,
  ConfigEntry,
  ConnectStmt,
  EncryptDecl,
  FnDecl,
  GuardStmt,
  ImportDecl,
  MatchExpr,
  MeshDecl,
  MetaBlock,
  NodeDecl,
  OutputCall,
  Param,
  Program,
  PureFnDecl,
  RenderBlock,
  Statement,
  TSPassthrough,
} from "./ast";

/** A single generated line mapped back to its originating source line. */
export interface LineMapping {
  /** 1-based generated line number. */
  generatedLine: number;
  /** 1-based original source line number. */
  originalLine: number;
}

/** The result of transforming a program. */
export interface TransformResult {
  /** The emitted TypeScript source. */
  code: string;
  /** Per-line mapping from generated to original lines. */
  mappings: LineMapping[];
  /** Names of all atoms encountered (reactivity metadata). */
  atoms: string[];
}

/** Indentation unit (two spaces). */
const INDENT = "  ";

/**
 * Transforms an Atomis AST into TypeScript source text.
 */
export class Transformer {
  private readonly lines: string[] = [];
  private readonly mappings: LineMapping[] = [];
  private readonly atoms: string[] = [];

  /**
   * Transform a program.
   * @param program The parsed/analyzed program.
   * @returns The {@link TransformResult}.
   */
  public transform(program: Program): TransformResult {
    for (const stmt of program.body) {
      this.emitStatement(stmt, 0);
    }
    return {
      code: this.lines.join("\n") + (this.lines.length ? "\n" : ""),
      mappings: this.mappings,
      atoms: this.atoms,
    };
  }

  /* ── emission primitives ───────────────────────────────────────────── */

  /**
   * Append one generated line.
   * @param text The line content (without indentation).
   * @param indent Indentation depth in units.
   * @param srcLine Originating source line for the source map.
   */
  private emit(text: string, indent: number, srcLine: number): void {
    const content = text.length ? INDENT.repeat(indent) + text : "";
    this.lines.push(content);
    this.mappings.push({
      generatedLine: this.lines.length,
      originalLine: srcLine,
    });
  }

  /** Emit a blank separator line (mapped to the given source line). */
  private blank(srcLine: number): void {
    this.emit("", 0, srcLine);
  }

  /* ── statement dispatch ────────────────────────────────────────────── */

  /**
   * Emit a single statement.
   * @param stmt The statement node.
   * @param indent Current indentation depth.
   */
  private emitStatement(stmt: Statement, indent: number): void {
    switch (stmt.type) {
      case "TSPassthrough":
        this.emitPassthrough(stmt, indent);
        break;
      case "AtomDecl":
        this.emitAtom(stmt, indent);
        break;
      case "FnDecl":
        this.emitFn(stmt, indent, false);
        break;
      case "PureFnDecl":
        this.emitFn(stmt, indent, true);
        break;
      case "GuardStmt":
        this.emitGuard(stmt, indent);
        break;
      case "MatchExpr":
        this.emitMatch(stmt, indent);
        break;
      case "OutputCall":
        this.emitOutput(stmt, indent);
        break;
      case "ImportDecl":
        this.emitImport(stmt, indent);
        break;
      case "MetaBlock":
        this.emitMeta(stmt, indent);
        break;
      case "CellBlock":
        this.emitCell(stmt, indent);
        break;
      case "RenderBlock":
        this.emitRender(stmt, indent);
        break;
      case "NodeDecl":
        this.emitNode(stmt, indent);
        break;
      case "ChannelDecl":
        this.emitChannel(stmt, indent);
        break;
      case "MeshDecl":
        this.emitMesh(stmt, indent);
        break;
      case "ConnectStmt":
        this.emitConnect(stmt, indent);
        break;
      case "EncryptDecl":
        this.emitEncrypt(stmt, indent);
        break;
      default:
        break;
    }
  }

  /* ── Layer 1 ───────────────────────────────────────────────────────── */

  /** Emit a TypeScript passthrough chunk, applying `Result`/`Ok`/`Err` sugar. */
  private emitPassthrough(stmt: TSPassthrough, indent: number): void {
    const rewritten = rewriteResultSugar(stmt.raw);
    const rows = rewritten.split("\n");
    rows.forEach((row, i) => {
      this.emit(row.replace(/\s+$/, ""), indent, stmt.line + i);
    });
  }

  /* ── Layer 2 ───────────────────────────────────────────────────────── */

  private emitAtom(stmt: AtomDecl, indent: number): void {
    this.atoms.push(stmt.name);
    let line = `let ${stmt.name}`;
    if (stmt.typeAnnotation) line += `: ${rewriteResultSugar(stmt.typeAnnotation)}`;
    if (stmt.initializer !== undefined) {
      line += ` = ${rewriteResultSugar(stmt.initializer)}`;
    }
    this.emit(line, indent, stmt.line);
  }

  private emitFn(stmt: FnDecl | PureFnDecl, indent: number, pure: boolean): void {
    if (pure) this.emit("/** @pure */", indent, stmt.line);
    const asyncKw = stmt.isAsync ? "async " : "";
    const params = stmt.params.map((p) => this.renderParam(p)).join(", ");
    const ret = stmt.returnType ? `: ${rewriteResultSugar(stmt.returnType)}` : "";
    this.emit(`${asyncKw}function ${stmt.name}(${params})${ret} {`, indent, stmt.line);
    for (const s of stmt.body) this.emitStatement(s, indent + 1);
    this.emit("}", indent, stmt.line);
  }

  private renderParam(p: Param): string {
    let s = p.name;
    if (p.typeAnnotation) s += `: ${rewriteResultSugar(p.typeAnnotation)}`;
    if (p.defaultValue !== undefined) s += ` = ${rewriteResultSugar(p.defaultValue)}`;
    return s;
  }

  private emitGuard(stmt: GuardStmt, indent: number): void {
    const cond = `if (!(${stmt.condition}))`;
    // Inline single-statement guard bodies (e.g. `{ return }`).
    if (stmt.elseBody.length === 1 && this.isInlineable(stmt.elseBody[0])) {
      const inline = rewriteResultSugar((stmt.elseBody[0] as TSPassthrough).raw.trim());
      this.emit(`${cond} { ${inline} }`, indent, stmt.line);
      return;
    }
    this.emit(`${cond} {`, indent, stmt.line);
    for (const s of stmt.elseBody) this.emitStatement(s, indent + 1);
    this.emit("}", indent, stmt.line);
  }

  private isInlineable(stmt: Statement): boolean {
    return (
      stmt.type === "TSPassthrough" &&
      !stmt.raw.includes("\n") &&
      !stmt.raw.includes("{")
    );
  }

  private emitMatch(stmt: MatchExpr, indent: number): void {
    const disc = rewriteResultSugar(stmt.discriminant);
    let first = true;
    for (const arm of stmt.arms) {
      const body = `{ ${rewriteResultSugar(arm.result.trim())} }`;
      const pattern = rewriteResultSugar(arm.pattern.trim());
      if (arm.isWildcard) {
        this.emit(`else ${body}`, indent, arm.line);
      } else if (first) {
        this.emit(`if (${disc} === ${pattern}) ${body}`, indent, arm.line);
        first = false;
      } else {
        this.emit(`else if (${disc} === ${pattern}) ${body}`, indent, arm.line);
      }
    }
  }

  private emitOutput(stmt: OutputCall, indent: number): void {
    this.emit(`console.log(${rewriteResultSugar(stmt.argument)})`, indent, stmt.line);
  }

  private emitImport(stmt: ImportDecl, indent: number): void {
    this.emit(`import { ${stmt.names.join(", ")} } from "${stmt.module}"`, indent, stmt.line);
  }

  private emitMeta(stmt: MetaBlock, indent: number): void {
    this.emit("export const __atomis_meta = {", indent, stmt.line);
    this.emitEntries(stmt.entries, indent + 1);
    this.emit("}", indent, stmt.line);
  }

  /* ── decorators / cells / render ───────────────────────────────────── */

  private emitCell(stmt: CellBlock, indent: number): void {
    const arrow = stmt.isAsync ? "async () =>" : "() =>";
    this.emit(`__atomis_cell(${JSON.stringify(stmt.name)}, ${arrow} {`, indent, stmt.line);
    for (const s of stmt.body) this.emitStatement(s, indent + 1);
    this.emit("})", indent, stmt.line);
  }

  private emitRender(stmt: RenderBlock, indent: number): void {
    for (const view of stmt.views) {
      this.emit(`function ${view.name}() {`, indent, view.line);
      this.emit("return (", indent + 1, view.line);
      const jsxRows = view.jsx.split("\n");
      jsxRows.forEach((row, i) => {
        this.emit(row.trim(), indent + 2, view.line + i);
      });
      this.emit(");", indent + 1, view.line);
      this.emit("}", indent, view.line);
    }
  }

  /* ── Layer 3: GhostNet ─────────────────────────────────────────────── */

  private emitNode(stmt: NodeDecl, indent: number): void {
    const ident = idToIdent(stmt.id);
    this.emit(`const ${ident} = new GhostNode({`, indent, stmt.line);
    const props: ConfigEntry[] = [this.idEntry(stmt.id, stmt.line), ...stmt.config];
    this.emitEntries(props, indent + 1);
    this.emit("})", indent, stmt.line);
  }

  private emitChannel(stmt: ChannelDecl, indent: number): void {
    const ident = idToIdent(stmt.id);
    this.emit(`const ${ident} = new GhostChannel({`, indent, stmt.line);
    const props: ConfigEntry[] = [this.idEntry(stmt.id, stmt.line), ...stmt.config];
    this.emitEntries(props, indent + 1);
    this.emit("})", indent, stmt.line);
  }

  private emitMesh(stmt: MeshDecl, indent: number): void {
    const ident = idToIdent(stmt.id);
    this.emit(`const ${ident} = new GhostMesh({`, indent, stmt.line);
    const props: ConfigEntry[] = [this.idEntry(stmt.id, stmt.line), ...stmt.config];
    this.emitEntries(props, indent + 1);
    this.emit("})", indent, stmt.line);
  }

  private emitConnect(stmt: ConnectStmt, indent: number): void {
    const ch = idToIdent(stmt.channel);
    const node = idToIdent(stmt.node);
    this.emit(`${ch}.connect(${node}, ${JSON.stringify(stmt.transport)})`, indent, stmt.line);
  }

  private emitEncrypt(stmt: EncryptDecl, indent: number): void {
    this.emit("setEncryptionPolicy({", indent, stmt.line);
    this.emitEntries(stmt.config, indent + 1);
    this.emit("})", indent, stmt.line);
  }

  /* ── shared helpers ────────────────────────────────────────────────── */

  /** Build the synthetic `id: "<id>"` config entry for GhostNet objects. */
  private idEntry(id: string, line: number): ConfigEntry {
    return {
      type: "ConfigEntry",
      line,
      col: 0,
      key: "id",
      value: JSON.stringify(id),
    };
  }

  /** Emit object-literal entries (`key: value,`) with trailing commas. */
  private emitEntries(entries: ConfigEntry[], indent: number): void {
    entries.forEach((e, i) => {
      const comma = i < entries.length - 1 ? "," : "";
      this.emit(`${e.key}: ${e.value}${comma}`, indent, e.line);
    });
  }
}

/* ── module-level utilities ──────────────────────────────────────────── */

/**
 * Convert a GhostNet string id into a safe TS identifier, e.g.
 * `"node-01"` → `"__node_01"`.
 * @param id The raw id string.
 * @returns A valid TypeScript identifier.
 */
export function idToIdent(id: string): string {
  return "__" + id.replace(/[^A-Za-z0-9_$]/g, "_");
}

/**
 * Rewrite Atomis `Result` sugar inside a chunk of expression/statement text:
 *  - `Ok(v)`        → `{ ok: true, value: v }`
 *  - `Err(e)`       → `{ ok: false, error: e }`
 *  - `Result<T, E>` → `{ ok: true, value: T } | { ok: false, error: E }`
 *
 * The rewrite is intentionally lexical (regex/scan based) because the bodies
 * are carried as raw passthrough text rather than fully parsed expressions.
 * @param text The source text to rewrite.
 * @returns The rewritten text.
 */
export function rewriteResultSugar(text: string): string {
  let out = text;
  out = rewriteCall(out, "Ok", (arg) => `{ ok: true, value: ${arg} }`);
  out = rewriteCall(out, "Err", (arg) => `{ ok: false, error: ${arg} }`);
  out = rewriteResultType(out);
  return out;
}

/**
 * Replace `Name(arg)` calls (with balanced parentheses) using `build`.
 * Only matches when `Name` is not part of a larger identifier.
 */
function rewriteCall(text: string, name: string, build: (arg: string) => string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(name + "(", i);
    if (idx === -1) {
      result += text.slice(i);
      break;
    }
    const prev = text[idx - 1] ?? "";
    const isBoundary = !/[A-Za-z0-9_$.]/.test(prev);
    if (!isBoundary) {
      result += text.slice(i, idx + name.length);
      i = idx + name.length;
      continue;
    }
    // Find the matching close paren.
    let depth = 0;
    let j = idx + name.length;
    for (; j < text.length; j++) {
      if (text[j] === "(") depth++;
      else if (text[j] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j >= text.length) {
      result += text.slice(i);
      break;
    }
    const arg = text.slice(idx + name.length + 1, j).trim();
    result += text.slice(i, idx) + build(arg);
    i = j + 1;
  }
  return result;
}

/** Replace `Result<T, E>` type references with the structural union type. */
function rewriteResultType(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf("Result<", i);
    if (idx === -1) {
      result += text.slice(i);
      break;
    }
    const prev = text[idx - 1] ?? "";
    if (/[A-Za-z0-9_$.]/.test(prev)) {
      result += text.slice(i, idx + 7);
      i = idx + 7;
      continue;
    }
    // Balance angle brackets.
    let depth = 0;
    let j = idx + 6; // points at '<'
    for (; j < text.length; j++) {
      if (text[j] === "<") depth++;
      else if (text[j] === ">") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j >= text.length) {
      result += text.slice(i);
      break;
    }
    const inner = text.slice(idx + 7, j);
    const [t, e] = splitTopLevelComma(inner);
    const tType = (t ?? "unknown").trim();
    const eType = (e ?? "Error").trim();
    result +=
      text.slice(i, idx) +
      `{ ok: true, value: ${tType} } | { ok: false, error: ${eType} }`;
    i = j + 1;
  }
  return result;
}

/** Split `T, E` at the top-level comma, respecting nested generics. */
function splitTopLevelComma(s: string): [string, string?] {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      return [s.slice(0, i), s.slice(i + 1)];
    }
  }
  return [s];
}

/**
 * Convenience wrapper: transform a program in one call.
 * @param program The parsed program.
 * @returns The transform result.
 */
export function transform(program: Program): TransformResult {
  return new Transformer().transform(program);
}
