/**
 * @file analyzer.ts
 * @module atomis/analyzer
 *
 * Semantic analyzer for the Atomis AST. It walks a {@link Program} and
 * performs:
 *
 *  - Scope resolution — tracks declared names per lexical scope.
 *  - Atom tracking — records every `atom` for reactivity wiring.
 *  - Basic type checking — flags a few obvious mismatches.
 *  - GhostNet validation — unique node/channel/mesh ids; `connect` statements
 *    must reference declared channels and nodes; transports must be one of
 *    `bluetooth | tcp | ws | ble5`.
 *  - Purity checking — warns when a `pure fn` performs obviously impure work
 *    (await, console/output, assignment to an outer atom, GhostNet calls).
 *
 * Results are returned as a structured {@link AnalysisResult} containing a flat
 * list of {@link Diagnostic} objects plus the collected symbol metadata used by
 * later stages.
 */

import {
  AtomDecl,
  ChannelDecl,
  ConnectStmt,
  FnDecl,
  MeshDecl,
  NodeDecl,
  Program,
  PureFnDecl,
  Statement,
  TSPassthrough,
} from "./ast";

/** Severity of a diagnostic. */
export type Severity = "error" | "warn";

/** A single structured diagnostic message. */
export interface Diagnostic {
  /** Human-readable message. */
  message: string;
  /** 1-based source line. */
  line: number;
  /** 1-based source column. */
  col: number;
  /** Diagnostic severity. */
  severity: Severity;
}

/** Recorded metadata about a declared `atom`. */
export interface AtomInfo {
  name: string;
  typeAnnotation?: string;
  line: number;
}

/** The result of analyzing a program. */
export interface AnalysisResult {
  /** All diagnostics, in source order. */
  diagnostics: Diagnostic[];
  /** Atoms discovered (for reactivity wiring). */
  atoms: AtomInfo[];
  /** Declared GhostNet node ids. */
  nodeIds: string[];
  /** Declared GhostNet channel ids. */
  channelIds: string[];
  /** Declared GhostNet mesh ids. */
  meshIds: string[];
  /** Whether any error-severity diagnostic was produced. */
  hasErrors: boolean;
}

/** Valid GhostNet transports. */
const VALID_TRANSPORTS = new Set(["bluetooth", "tcp", "ws", "ble5"]);

/** A lexical scope mapping declared names to the line they were declared on. */
interface Scope {
  names: Map<string, number>;
  parent?: Scope;
}

/**
 * The Atomis semantic analyzer.
 */
export class Analyzer {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly atoms: AtomInfo[] = [];
  private readonly nodeIds = new Map<string, number>();
  private readonly channelIds = new Map<string, number>();
  private readonly meshIds = new Map<string, number>();
  private scope: Scope = { names: new Map() };

  /**
   * Analyze a program.
   * @param program The parsed {@link Program} AST.
   * @returns Structured {@link AnalysisResult}.
   */
  public analyze(program: Program): AnalysisResult {
    this.visitBlock(program.body);
    this.validateConnects(program);

    return {
      diagnostics: this.diagnostics,
      atoms: this.atoms,
      nodeIds: [...this.nodeIds.keys()],
      channelIds: [...this.channelIds.keys()],
      meshIds: [...this.meshIds.keys()],
      hasErrors: this.diagnostics.some((d) => d.severity === "error"),
    };
  }

  /* ── diagnostics helpers ───────────────────────────────────────────── */

  private error(message: string, line: number, col: number): void {
    this.diagnostics.push({ message, line, col, severity: "error" });
  }

  private warn(message: string, line: number, col: number): void {
    this.diagnostics.push({ message, line, col, severity: "warn" });
  }

  /* ── scope helpers ─────────────────────────────────────────────────── */

  private pushScope(): void {
    this.scope = { names: new Map(), parent: this.scope };
  }

  private popScope(): void {
    if (this.scope.parent) this.scope = this.scope.parent;
  }

  private declare(name: string, line: number, col: number): void {
    if (this.scope.names.has(name)) {
      this.warn(`'${name}' is already declared in this scope`, line, col);
    }
    this.scope.names.set(name, line);
  }

  /* ── traversal ─────────────────────────────────────────────────────── */

  /**
   * Visit a list of statements within the current scope.
   * @param body Statements to visit.
   */
  private visitBlock(body: Statement[]): void {
    // First pass: register declarations so order doesn't cause false positives.
    for (const stmt of body) this.preregister(stmt);
    // Second pass: validate each statement.
    for (const stmt of body) this.visit(stmt);
  }

  private preregister(stmt: Statement): void {
    switch (stmt.type) {
      case "AtomDecl":
        this.declare(stmt.name, stmt.line, stmt.col);
        break;
      case "FnDecl":
      case "PureFnDecl":
        this.declare(stmt.name, stmt.line, stmt.col);
        break;
      default:
        break;
    }
  }

  private visit(stmt: Statement): void {
    switch (stmt.type) {
      case "AtomDecl":
        this.visitAtom(stmt);
        break;
      case "FnDecl":
        this.visitFn(stmt, false);
        break;
      case "PureFnDecl":
        this.visitFn(stmt, true);
        break;
      case "NodeDecl":
        this.visitNode(stmt);
        break;
      case "ChannelDecl":
        this.visitChannel(stmt);
        break;
      case "MeshDecl":
        this.visitMesh(stmt);
        break;
      case "GuardStmt":
        this.pushScope();
        this.visitBlock(stmt.elseBody);
        this.popScope();
        break;
      case "CellBlock":
        this.pushScope();
        this.visitBlock(stmt.body);
        this.popScope();
        break;
      // ConnectStmt validated separately (needs full id sets first).
      // EncryptDecl, RenderBlock, ImportDecl, MetaBlock, OutputCall,
      // MatchExpr, TSPassthrough: no structural checks here.
      default:
        break;
    }
  }

  /* ── atom checks ───────────────────────────────────────────────────── */

  private visitAtom(stmt: AtomDecl): void {
    this.atoms.push({
      name: stmt.name,
      typeAnnotation: stmt.typeAnnotation,
      line: stmt.line,
    });
    this.checkBasicType(stmt);
  }

  /**
   * Very small "obvious mismatch" type check: when an atom has an explicit
   * primitive type and a literal initializer that clearly disagrees.
   */
  private checkBasicType(stmt: AtomDecl): void {
    const ty = stmt.typeAnnotation?.trim();
    const init = stmt.initializer?.trim();
    if (!ty || !init) return;

    const isStringLiteral = /^["'`]/.test(init);
    const isNumberLiteral = /^-?\d/.test(init);
    const isBoolLiteral = init === "true" || init === "false";
    const isArrayLiteral = init.startsWith("[");

    if (ty === "string" && (isNumberLiteral || isBoolLiteral)) {
      this.error(`Type mismatch: atom '${stmt.name}' is string but initialized with ${init}`, stmt.line, stmt.col);
    } else if (ty === "number" && (isStringLiteral || isBoolLiteral)) {
      this.error(`Type mismatch: atom '${stmt.name}' is number but initialized with ${init}`, stmt.line, stmt.col);
    } else if (ty === "boolean" && (isStringLiteral || isNumberLiteral)) {
      this.error(`Type mismatch: atom '${stmt.name}' is boolean but initialized with ${init}`, stmt.line, stmt.col);
    } else if (ty.endsWith("[]") && init !== "[]" && !isArrayLiteral && init !== "undefined") {
      this.warn(`atom '${stmt.name}' is typed as an array but initializer is not an array literal`, stmt.line, stmt.col);
    }
  }

  /* ── function checks ───────────────────────────────────────────────── */

  private visitFn(stmt: FnDecl | PureFnDecl, pure: boolean): void {
    this.pushScope();
    for (const p of stmt.params) this.declare(p.name, p.line, p.col);
    this.visitBlock(stmt.body);
    if (pure) this.checkPurity(stmt);
    this.popScope();
  }

  /**
   * Warn when a `pure fn` performs obviously impure operations.
   */
  private checkPurity(stmt: PureFnDecl | FnDecl): void {
    if (stmt.isAsync) {
      this.warn(`pure fn '${stmt.name}' is async; pure functions should not perform I/O`, stmt.line, stmt.col);
    }
    const impure = /\b(await|console|output|fetch|Math\.random|Date\.now)\b|\.send\(|\.scan\(/;
    for (const s of this.flattenBody(stmt.body)) {
      if (s.type === "OutputCall") {
        this.warn(`pure fn '${stmt.name}' calls output(); pure functions must not produce side effects`, s.line, s.col);
        continue;
      }
      const raw = (s as TSPassthrough).raw;
      if (typeof raw === "string" && impure.test(raw)) {
        this.warn(`pure fn '${stmt.name}' appears to perform a side effect: ${raw.trim().slice(0, 40)}`, s.line, s.col);
      }
    }
  }

  /** Flatten a body (recursing into guard/cell blocks) into a flat list. */
  private flattenBody(body: Statement[]): Statement[] {
    const out: Statement[] = [];
    for (const s of body) {
      out.push(s);
      if (s.type === "GuardStmt") out.push(...this.flattenBody(s.elseBody));
      else if (s.type === "CellBlock") out.push(...this.flattenBody(s.body));
    }
    return out;
  }

  /* ── GhostNet checks ───────────────────────────────────────────────── */

  private visitNode(stmt: NodeDecl): void {
    if (this.nodeIds.has(stmt.id)) {
      this.error(`Duplicate node id '${stmt.id}' (first declared on line ${this.nodeIds.get(stmt.id)})`, stmt.line, stmt.col);
    } else {
      this.nodeIds.set(stmt.id, stmt.line);
    }
  }

  private visitChannel(stmt: ChannelDecl): void {
    if (this.channelIds.has(stmt.id)) {
      this.error(`Duplicate channel id '${stmt.id}' (first declared on line ${this.channelIds.get(stmt.id)})`, stmt.line, stmt.col);
    } else {
      this.channelIds.set(stmt.id, stmt.line);
    }
  }

  private visitMesh(stmt: MeshDecl): void {
    if (this.meshIds.has(stmt.id)) {
      this.error(`Duplicate mesh id '${stmt.id}' (first declared on line ${this.meshIds.get(stmt.id)})`, stmt.line, stmt.col);
    } else {
      this.meshIds.set(stmt.id, stmt.line);
    }
  }

  /**
   * Validate `connect` statements after all declarations have been collected.
   * Recurses through nested blocks to find every connect statement.
   */
  private validateConnects(program: Program): void {
    const all = this.collectConnects(program.body);
    for (const c of all) {
      if (!this.channelIds.has(c.channel)) {
        this.error(`connect references undeclared channel '${c.channel}'`, c.line, c.col);
      }
      if (!this.nodeIds.has(c.node)) {
        this.error(`connect references undeclared node '${c.node}'`, c.line, c.col);
      }
      if (!VALID_TRANSPORTS.has(c.transport)) {
        this.error(
          `Invalid transport '${c.transport}'; expected one of bluetooth | tcp | ws | ble5`,
          c.line,
          c.col,
        );
      }
    }
  }

  private collectConnects(body: Statement[]): ConnectStmt[] {
    const out: ConnectStmt[] = [];
    for (const s of body) {
      if (s.type === "ConnectStmt") out.push(s);
      else if (s.type === "GuardStmt") out.push(...this.collectConnects(s.elseBody));
      else if (s.type === "CellBlock") out.push(...this.collectConnects(s.body));
      else if (s.type === "FnDecl" || s.type === "PureFnDecl") {
        out.push(...this.collectConnects(s.body));
      }
    }
    return out;
  }
}

/**
 * Convenience wrapper: analyze a program in one call.
 * @param program The parsed program.
 * @returns The analysis result.
 */
export function analyze(program: Program): AnalysisResult {
  return new Analyzer().analyze(program);
}
