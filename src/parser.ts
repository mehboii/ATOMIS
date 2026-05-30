/**
 * @file parser.ts
 * @module atomis/parser
 *
 * Hand-written recursive-descent parser for Atomis.
 *
 * The parser consumes the {@link Token} stream produced by {@link Lexer} and
 * yields an Atomis {@link Program} AST. Its central design principle follows
 * the three-layer language model:
 *
 *  - At every statement boundary it tries to recognize a Layer-2 (Atomis sugar)
 *    or Layer-3 (GhostNet) construct from the leading token(s).
 *  - Anything it does not recognize is collected verbatim as a
 *    {@link TSPassthrough} node (Layer 1), preserving the exact source text by
 *    slicing the original source between token offsets.
 *
 * No parser-generator libraries are used — this is entirely handwritten.
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
  MatchArm,
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
  ViewDecl,
} from "./ast";
import { Token, TokenType } from "./lexer";

/** A parse error carrying source coordinates. */
export class ParseError extends Error {
  /**
   * @param message Human-readable description.
   * @param line 1-based source line.
   * @param col 1-based source column.
   */
  constructor(message: string, public line: number, public col: number) {
    super(`[${line}:${col}] ${message}`);
    this.name = "ParseError";
  }
}

/** Identifiers that act as boolean/null literals and are NOT quoted. */
const LITERAL_WORDS = new Set(["true", "false", "null", "undefined"]);

/**
 * Recursive-descent parser for Atomis source.
 */
export class Parser {
  private readonly tokens: Token[];
  private readonly src: string;
  private pos = 0;

  /**
   * @param tokens Token stream from the lexer (including NEWLINE/COMMENT/EOF).
   * @param source Original source text, used for verbatim passthrough slicing.
   */
  constructor(tokens: Token[], source: string) {
    this.tokens = tokens;
    this.src = source;
  }

  /**
   * Parse the whole token stream into a program.
   * @returns The root {@link Program} node.
   */
  public parse(): Program {
    const body: Statement[] = [];
    const first = this.peek();
    while (!this.atEnd()) {
      this.skipTrivia();
      if (this.atEnd()) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }
    return {
      type: "Program",
      line: first.line,
      col: first.col,
      body,
    };
  }

  /* ── cursor helpers ────────────────────────────────────────────────── */

  private peek(offset = 0): Token {
    const i = this.pos + offset;
    return this.tokens[i] ?? this.tokens[this.tokens.length - 1];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private atEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private check(type: TokenType, value?: string): boolean {
    const t = this.peek();
    if (t.type !== type) return false;
    return value === undefined || t.value === value;
  }

  private expect(type: TokenType, value?: string): Token {
    if (!this.check(type, value)) {
      const t = this.peek();
      throw new ParseError(
        `Expected ${type}${value ? ` '${value}'` : ""} but found ${t.type} '${t.value}'`,
        t.line,
        t.col,
      );
    }
    return this.next();
  }

  /** Skip NEWLINE and COMMENT tokens. */
  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE) || this.check(TokenType.COMMENT)) {
      this.next();
    }
  }

  /** Skip only leading NEWLINEs/COMMENTs (alias kept for readability). */
  private skipTrivia(): void {
    this.skipNewlines();
  }

  /* ── statement dispatch ────────────────────────────────────────────── */

  /**
   * Parse one statement, dispatching to the appropriate construct parser or
   * falling back to TypeScript passthrough.
   * @returns The parsed statement, or `null` if only trivia was consumed.
   */
  private parseStatement(): Statement | null {
    this.skipTrivia();
    if (this.atEnd()) return null;

    const t = this.peek();

    // Decorators.
    if (t.type === TokenType.DECORATOR) {
      return this.parseDecorator();
    }

    // `async fn` / `async pure fn`.
    if (
      t.type === TokenType.IDENT &&
      t.value === "async" &&
      (this.peek(1).value === "fn" || this.peek(1).value === "pure")
    ) {
      this.next(); // consume 'async'
      return this.parseFnLike(true);
    }

    if (t.type === TokenType.KEYWORD) {
      const n1 = this.peek(1);
      const n2 = this.peek(2);
      switch (t.value) {
        case "atom":
          // `atom name ...` — name must be an identifier.
          if (n1.type === TokenType.IDENT) return this.parseAtom();
          break;
        case "fn":
        case "pure":
          return this.parseFnLike(false);
        case "node":
          // `node "id"` or `node kind "id"`.
          if (
            n1.type === TokenType.STRING ||
            ((n1.type === TokenType.IDENT || n1.type === TokenType.KEYWORD) &&
              n2.type === TokenType.STRING)
          ) {
            return this.parseNode();
          }
          break;
        case "channel":
          if (n1.type === TokenType.STRING) return this.parseChannel();
          break;
        case "mesh":
          if (n1.type === TokenType.STRING) return this.parseMesh();
          break;
        case "connect":
          if (n1.type === TokenType.STRING) return this.parseConnect();
          break;
        case "encrypt":
          if (n1.type === TokenType.LBRACE) return this.parseEncrypt();
          break;
        case "guard":
          // Not a guard if used as an identifier (`guard.x`, `guard(`, `guard =`).
          if (!(n1.value === "." || n1.value === "(" || n1.value === "=")) {
            return this.parseGuard();
          }
          break;
        case "match":
          if (!(n1.value === "." || n1.value === "(" || n1.value === "=")) {
            return this.parseMatch();
          }
          break;
        case "output":
          // Disambiguate `output(...)` call from an identifier usage.
          if (n1.value === "(") return this.parseOutput();
          break;
        default:
          break;
      }
    }

    // Everything else: raw TypeScript passthrough.
    return this.parseRawStatement();
  }

  /* ── Layer 1: passthrough ──────────────────────────────────────────── */

  /**
   * Collect a verbatim TypeScript statement as a {@link TSPassthrough} node.
   * Tracks bracket depth and terminates on a `;`, a balanced end-of-line, a
   * closing `}` belonging to an enclosing block, or EOF.
   */
  private parseRawStatement(): TSPassthrough {
    const start = this.peek();
    const startOffset = start.start;
    let endOffset = start.end;
    let depth = 0;

    while (!this.atEnd()) {
      const tk = this.peek();

      if (tk.type === TokenType.NEWLINE) {
        if (depth === 0 && !this.continues(endOffset)) {
          this.next();
          break;
        }
        this.next();
        continue;
      }
      if (tk.type === TokenType.COMMENT) {
        this.next();
        continue;
      }

      if (this.isOpen(tk)) depth++;
      else if (this.isClose(tk)) {
        if (depth === 0 && tk.type === TokenType.RBRACE) {
          // Closes an enclosing block — do not consume.
          break;
        }
        depth--;
      }

      endOffset = tk.end;
      this.next();

      if (depth === 0 && tk.type === TokenType.PUNCTUATION && tk.value === ";") {
        break;
      }
    }

    return {
      type: "TSPassthrough",
      line: start.line,
      col: start.col,
      raw: this.src.slice(startOffset, endOffset),
    };
  }

  /**
   * Decide whether a statement continues onto the next line by inspecting the
   * last consumed source character (e.g. trailing operator, comma, `{`).
   */
  private continues(endOffset: number): boolean {
    const text = this.src.slice(0, endOffset).trimEnd();
    const last = text[text.length - 1] ?? "";
    return "+-*/%=<>&|^,.([{?:".includes(last);
  }

  private isOpen(t: Token): boolean {
    return (
      t.type === TokenType.LBRACE ||
      (t.type === TokenType.PUNCTUATION && (t.value === "(" || t.value === "["))
    );
  }

  private isClose(t: Token): boolean {
    return (
      t.type === TokenType.RBRACE ||
      (t.type === TokenType.PUNCTUATION && (t.value === ")" || t.value === "]"))
    );
  }

  /* ── generic raw collectors ────────────────────────────────────────── */

  /**
   * Collect source text from the current position until `stop` returns true at
   * bracket depth 0 (the stopping token is NOT consumed). Returns the trimmed
   * verbatim source slice.
   */
  private rawUntil(stop: (t: Token, depth: number) => boolean): string {
    let startOffset = -1;
    let endOffset = -1;
    let depth = 0;
    while (!this.atEnd()) {
      const tk = this.peek();
      if (depth === 0 && stop(tk, depth)) break;
      if (tk.type === TokenType.NEWLINE || tk.type === TokenType.COMMENT) {
        this.next();
        continue;
      }
      if (this.isOpen(tk)) depth++;
      else if (this.isClose(tk)) depth--;
      if (startOffset < 0) startOffset = tk.start;
      endOffset = tk.end;
      this.next();
    }
    if (startOffset < 0) return "";
    return this.src.slice(startOffset, endOffset).trim();
  }

  /* ── Layer 2: atom ─────────────────────────────────────────────────── */

  /** Parse `atom name: Type = initializer`. */
  private parseAtom(): AtomDecl {
    const kw = this.expect(TokenType.KEYWORD, "atom");
    const name = this.expect(TokenType.IDENT).value;

    let typeAnnotation: string | undefined;
    if (this.check(TokenType.PUNCTUATION, ":")) {
      this.next();
      typeAnnotation = this.rawUntil(
        (t) =>
          (t.type === TokenType.OPERATOR && t.value === "=") ||
          t.type === TokenType.NEWLINE,
      );
    }

    let initializer: string | undefined;
    if (this.check(TokenType.OPERATOR, "=")) {
      this.next();
      initializer = this.rawUntil(
        (t) =>
          t.type === TokenType.NEWLINE ||
          (t.type === TokenType.PUNCTUATION && t.value === ";"),
      );
    }
    // Consume an optional trailing semicolon.
    if (this.check(TokenType.PUNCTUATION, ";")) this.next();

    return {
      type: "AtomDecl",
      line: kw.line,
      col: kw.col,
      name,
      typeAnnotation: typeAnnotation || undefined,
      initializer: initializer || undefined,
    };
  }

  /* ── Layer 2: fn / pure fn ─────────────────────────────────────────── */

  /**
   * Parse `fn` or `pure fn` declarations (optionally async).
   * @param isAsync Whether a leading `async` was already consumed.
   */
  private parseFnLike(isAsync: boolean): FnDecl | PureFnDecl {
    let isPure = false;
    const start = this.peek();
    if (this.check(TokenType.KEYWORD, "pure")) {
      this.next();
      isPure = true;
    }
    this.expect(TokenType.KEYWORD, "fn");
    const name = this.expect(TokenType.IDENT).value;
    const params = this.parseParams();

    let returnType: string | undefined;
    if (this.check(TokenType.ARROW)) {
      this.next();
      returnType = this.rawUntil((t) => t.type === TokenType.LBRACE);
    }

    const body = this.parseBraceBody();

    const base = {
      line: start.line,
      col: start.col,
      name,
      isAsync,
      params,
      returnType: returnType || undefined,
      body,
    };
    return isPure
      ? ({ type: "PureFnDecl", ...base } as PureFnDecl)
      : ({ type: "FnDecl", ...base } as FnDecl);
  }

  /** Parse a parenthesized parameter list `( name: Type = default, ... )`. */
  private parseParams(): Param[] {
    this.expect(TokenType.PUNCTUATION, "(");
    const params: Param[] = [];
    this.skipNewlines();
    while (!this.check(TokenType.PUNCTUATION, ")") && !this.atEnd()) {
      const nameTok = this.peek();
      const name = this.next().value;

      let typeAnnotation: string | undefined;
      if (this.check(TokenType.PUNCTUATION, ":")) {
        this.next();
        typeAnnotation = this.rawUntil(
          (t) =>
            (t.type === TokenType.PUNCTUATION && (t.value === "," || t.value === ")")) ||
            (t.type === TokenType.OPERATOR && t.value === "="),
        );
      }

      let defaultValue: string | undefined;
      if (this.check(TokenType.OPERATOR, "=")) {
        this.next();
        defaultValue = this.rawUntil(
          (t) => t.type === TokenType.PUNCTUATION && (t.value === "," || t.value === ")"),
        );
      }

      params.push({
        type: "Param",
        line: nameTok.line,
        col: nameTok.col,
        name,
        typeAnnotation: typeAnnotation || undefined,
        defaultValue: defaultValue || undefined,
      });

      this.skipNewlines();
      if (this.check(TokenType.PUNCTUATION, ",")) {
        this.next();
        this.skipNewlines();
      }
    }
    this.expect(TokenType.PUNCTUATION, ")");
    return params;
  }

  /**
   * Parse a `{ ... }` block as a list of statements.
   */
  private parseBraceBody(): Statement[] {
    this.expect(TokenType.LBRACE);
    const body: Statement[] = [];
    this.skipNewlines();
    while (!this.check(TokenType.RBRACE) && !this.atEnd()) {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }
    this.expect(TokenType.RBRACE);
    return body;
  }

  /* ── Layer 2: guard ────────────────────────────────────────────────── */

  /** Parse `guard condition else { body }`. */
  private parseGuard(): GuardStmt {
    const kw = this.expect(TokenType.KEYWORD, "guard");
    const condition = this.rawUntil(
      (t) => t.type === TokenType.KEYWORD && t.value === "else",
    );
    this.expect(TokenType.KEYWORD, "else");
    const elseBody = this.parseBraceBody();
    return {
      type: "GuardStmt",
      line: kw.line,
      col: kw.col,
      condition,
      elseBody,
    };
  }

  /* ── Layer 2: match ────────────────────────────────────────────────── */

  /** Parse `match expr { pattern => result, _ => result }`. */
  private parseMatch(): MatchExpr {
    const kw = this.expect(TokenType.KEYWORD, "match");
    const discriminant = this.rawUntil((t) => t.type === TokenType.LBRACE);
    this.expect(TokenType.LBRACE);
    const arms: MatchArm[] = [];
    this.skipNewlines();
    while (!this.check(TokenType.RBRACE) && !this.atEnd()) {
      const armStart = this.peek();
      const pattern = this.rawUntil(
        (t) => t.type === TokenType.OPERATOR && t.value === "=>",
      );
      this.expect(TokenType.OPERATOR, "=>");
      const result = this.rawUntil(
        (t) =>
          (t.type === TokenType.PUNCTUATION && t.value === ",") ||
          t.type === TokenType.RBRACE ||
          t.type === TokenType.NEWLINE,
      );
      arms.push({
        type: "MatchArm",
        line: armStart.line,
        col: armStart.col,
        pattern,
        isWildcard: pattern.trim() === "_",
        result,
      });
      this.skipNewlines();
      if (this.check(TokenType.PUNCTUATION, ",")) {
        this.next();
        this.skipNewlines();
      }
    }
    this.expect(TokenType.RBRACE);
    return {
      type: "MatchExpr",
      line: kw.line,
      col: kw.col,
      discriminant,
      arms,
    };
  }

  /* ── Layer 2: output ───────────────────────────────────────────────── */

  /** Parse `output(expr)`. */
  private parseOutput(): OutputCall {
    const kw = this.expect(TokenType.KEYWORD, "output");
    this.expect(TokenType.PUNCTUATION, "(");
    const argument = this.rawUntil(
      (t) => t.type === TokenType.PUNCTUATION && t.value === ")",
    );
    this.expect(TokenType.PUNCTUATION, ")");
    if (this.check(TokenType.PUNCTUATION, ";")) this.next();
    return {
      type: "OutputCall",
      line: kw.line,
      col: kw.col,
      argument,
    };
  }

  /* ── Decorators ────────────────────────────────────────────────────── */

  /** Dispatch a decorator construct (`@cell`, `@render`, `@import`, `@meta`). */
  private parseDecorator(): Statement {
    const dec = this.peek();
    switch (dec.value) {
      case "@cell":
        return this.parseCell();
      case "@render":
        return this.parseRender();
      case "@import":
        return this.parseImport();
      case "@meta":
        return this.parseMeta();
      default:
        // Unknown decorator → treat as passthrough so we stay resilient.
        return this.parseRawStatement();
    }
  }

  /**
   * Parse a cell block in either braced or inline form:
   *   `@cell #name { statements }`
   *   `@cell #name <newline> statements...` (until a blank line)
   */
  private parseCell(): CellBlock {
    const dec = this.expect(TokenType.DECORATOR, "@cell");
    // Optional `[ ... ]` wrapper and `#name`.
    if (this.check(TokenType.PUNCTUATION, "[")) this.next();
    if (this.check(TokenType.PUNCTUATION, "#")) this.next();
    const name = this.check(TokenType.IDENT) ? this.next().value : "cell";
    if (this.check(TokenType.PUNCTUATION, "]")) this.next();

    let body: Statement[];
    // Look past newlines to see whether a brace body follows.
    if (this.peekSkippingNewlines().type === TokenType.LBRACE) {
      this.skipNewlines();
      body = this.parseBraceBody();
    } else {
      body = this.parseInlineBlock();
    }

    const isAsync = body.some((s) => this.statementUsesAwait(s));
    return {
      type: "CellBlock",
      line: dec.line,
      col: dec.col,
      name,
      isAsync,
      body,
    };
  }

  /** Peek the next non-trivia token without consuming. */
  private peekSkippingNewlines(): Token {
    let i = this.pos;
    while (
      this.tokens[i] &&
      (this.tokens[i].type === TokenType.NEWLINE ||
        this.tokens[i].type === TokenType.COMMENT)
    ) {
      i++;
    }
    return this.tokens[i] ?? this.tokens[this.tokens.length - 1];
  }

  /**
   * Parse statements for an inline (brace-less) cell body until a blank line
   * (two or more consecutive newlines), a new top-level construct, or EOF.
   */
  private parseInlineBlock(): Statement[] {
    const body: Statement[] = [];
    // Skip the single newline immediately after the header.
    if (this.check(TokenType.NEWLINE)) this.next();

    while (!this.atEnd()) {
      // Count blank lines / trivia.
      let newlineCount = 0;
      while (this.check(TokenType.NEWLINE) || this.check(TokenType.COMMENT)) {
        if (this.check(TokenType.NEWLINE)) newlineCount++;
        this.next();
      }
      if (newlineCount >= 2) break; // blank line terminates the cell
      if (this.atEnd()) break;

      const t = this.peek();
      if (t.type === TokenType.DECORATOR) break;
      if (
        t.type === TokenType.KEYWORD &&
        ["fn", "pure", "node", "channel", "mesh", "connect", "encrypt", "atom"].includes(
          t.value,
        )
      ) {
        break;
      }
      if (t.type === TokenType.RBRACE) break;

      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }
    return body;
  }

  /** Heuristically determine whether a statement contains `await`. */
  private statementUsesAwait(s: Statement): boolean {
    const raw = (s as TSPassthrough).raw;
    if (typeof raw === "string") return /\bawait\b/.test(raw);
    if (s.type === "OutputCall") return /\bawait\b/.test(s.argument);
    return false;
  }

  /** Parse `@render { view Name { JSX } ... }`. */
  private parseRender(): RenderBlock {
    const dec = this.expect(TokenType.DECORATOR, "@render");
    this.skipNewlines();
    this.expect(TokenType.LBRACE);
    const views: ViewDecl[] = [];
    this.skipNewlines();
    while (!this.check(TokenType.RBRACE) && !this.atEnd()) {
      if (this.check(TokenType.KEYWORD, "view")) {
        views.push(this.parseView());
      } else {
        // Tolerate stray tokens.
        this.next();
      }
      this.skipNewlines();
    }
    this.expect(TokenType.RBRACE);
    return {
      type: "RenderBlock",
      line: dec.line,
      col: dec.col,
      views,
    };
  }

  /** Parse `view Name { JSX }` capturing the JSX body verbatim. */
  private parseView(): ViewDecl {
    const kw = this.expect(TokenType.KEYWORD, "view");
    const name = this.expect(TokenType.IDENT).value;
    const open = this.expect(TokenType.LBRACE);
    // Capture everything between the matching braces verbatim.
    let depth = 1;
    const startOffset = open.end;
    let endOffset = open.end;
    while (!this.atEnd() && depth > 0) {
      const tk = this.peek();
      if (tk.type === TokenType.LBRACE) depth++;
      else if (tk.type === TokenType.RBRACE) {
        depth--;
        if (depth === 0) break;
      }
      endOffset = tk.end;
      this.next();
    }
    this.expect(TokenType.RBRACE);
    return {
      type: "ViewDecl",
      line: kw.line,
      col: kw.col,
      name,
      jsx: this.src.slice(startOffset, endOffset).trim(),
    };
  }

  /** Parse `@import { a, b } from "module"`. */
  private parseImport(): ImportDecl {
    const dec = this.expect(TokenType.DECORATOR, "@import");
    this.expect(TokenType.LBRACE);
    const names: string[] = [];
    this.skipNewlines();
    while (!this.check(TokenType.RBRACE) && !this.atEnd()) {
      if (this.check(TokenType.IDENT) || this.check(TokenType.KEYWORD)) {
        names.push(this.next().value);
      } else {
        this.next();
      }
      this.skipNewlines();
      if (this.check(TokenType.PUNCTUATION, ",")) {
        this.next();
        this.skipNewlines();
      }
    }
    this.expect(TokenType.RBRACE);
    // `from "module"`
    if (this.check(TokenType.IDENT, "from")) this.next();
    const moduleTok = this.expect(TokenType.STRING);
    return {
      type: "ImportDecl",
      line: dec.line,
      col: dec.col,
      names,
      module: this.unquote(moduleTok.value),
    };
  }

  /** Parse `@meta { key: value, ... }`. */
  private parseMeta(): MetaBlock {
    const dec = this.expect(TokenType.DECORATOR, "@meta");
    const entries = this.parseConfigBlock();
    return {
      type: "MetaBlock",
      line: dec.line,
      col: dec.col,
      entries,
    };
  }

  /* ── Layer 3: GhostNet ─────────────────────────────────────────────── */

  /** Parse `node <kind> "<id>" { config }`. */
  private parseNode(): NodeDecl {
    const kw = this.expect(TokenType.KEYWORD, "node");
    let kind: string | undefined;
    // Optional kind keyword before the id string.
    if (this.check(TokenType.IDENT) || this.check(TokenType.KEYWORD)) {
      kind = this.next().value;
    }
    const id = this.unquote(this.expect(TokenType.STRING).value);
    const config = this.parseConfigBlock();
    return {
      type: "NodeDecl",
      line: kw.line,
      col: kw.col,
      kind,
      id,
      config,
    };
  }

  /** Parse `channel "<id>" { config }`. */
  private parseChannel(): ChannelDecl {
    const kw = this.expect(TokenType.KEYWORD, "channel");
    const id = this.unquote(this.expect(TokenType.STRING).value);
    const config = this.parseConfigBlock();
    return {
      type: "ChannelDecl",
      line: kw.line,
      col: kw.col,
      id,
      config,
    };
  }

  /** Parse `mesh "<id>" { config }`. */
  private parseMesh(): MeshDecl {
    const kw = this.expect(TokenType.KEYWORD, "mesh");
    const id = this.unquote(this.expect(TokenType.STRING).value);
    const config = this.parseConfigBlock();
    return {
      type: "MeshDecl",
      line: kw.line,
      col: kw.col,
      id,
      config,
    };
  }

  /** Parse `connect "<channel>" -> "<node>" via <transport>`. */
  private parseConnect(): ConnectStmt {
    const kw = this.expect(TokenType.KEYWORD, "connect");
    const channel = this.unquote(this.expect(TokenType.STRING).value);
    this.expect(TokenType.ARROW);
    const node = this.unquote(this.expect(TokenType.STRING).value);
    this.expect(TokenType.KEYWORD, "via");
    const transportTok = this.peek();
    const transport = this.next().value;
    if (this.check(TokenType.PUNCTUATION, ";")) this.next();
    return {
      type: "ConnectStmt",
      line: kw.line,
      col: kw.col,
      channel,
      node,
      transport: this.unquote(transport) || transportTok.value,
    };
  }

  /** Parse `encrypt { config }`. */
  private parseEncrypt(): EncryptDecl {
    const kw = this.expect(TokenType.KEYWORD, "encrypt");
    const config = this.parseConfigBlock();
    return {
      type: "EncryptDecl",
      line: kw.line,
      col: kw.col,
      config,
    };
  }

  /* ── config blocks ─────────────────────────────────────────────────── */

  /**
   * Parse a `{ key: value, ... }` configuration block shared by node, channel,
   * mesh, encrypt and `@meta`. Entries may be separated by commas and/or
   * newlines. Bare-word values are normalized to quoted strings.
   */
  private parseConfigBlock(): ConfigEntry[] {
    this.expect(TokenType.LBRACE);
    const entries: ConfigEntry[] = [];
    this.skipNewlines();
    while (!this.check(TokenType.RBRACE) && !this.atEnd()) {
      const keyTok = this.peek();
      const key = this.next().value;
      this.expect(TokenType.PUNCTUATION, ":");
      const value = this.parseConfigValue();
      entries.push({
        type: "ConfigEntry",
        line: keyTok.line,
        col: keyTok.col,
        key,
        value,
      });
      this.skipNewlines();
      if (this.check(TokenType.PUNCTUATION, ",")) {
        this.next();
        this.skipNewlines();
      }
    }
    this.expect(TokenType.RBRACE);
    return entries;
  }

  /**
   * Read a config value's tokens (up to a comma/newline/`}` at depth 0) and
   * normalize them into a TypeScript-ready expression string. Bare identifiers
   * become quoted strings; booleans, numbers, strings, and arrays are kept,
   * with identifiers inside arrays also quoted.
   */
  private parseConfigValue(): string {
    const valueTokens: Token[] = [];
    let depth = 0;
    while (!this.atEnd()) {
      const tk = this.peek();
      if (
        depth === 0 &&
        (tk.type === TokenType.NEWLINE ||
          tk.type === TokenType.RBRACE ||
          (tk.type === TokenType.PUNCTUATION && tk.value === ","))
      ) {
        break;
      }
      if (tk.type === TokenType.COMMENT) {
        this.next();
        continue;
      }
      if (this.isOpen(tk)) depth++;
      else if (this.isClose(tk)) depth--;
      valueTokens.push(tk);
      this.next();
    }
    return this.renderConfigValue(valueTokens);
  }

  /**
   * Join normalized value tokens into a TS expression string with sensible
   * spacing, quoting bare identifiers.
   */
  private renderConfigValue(tokens: Token[]): string {
    const parts: string[] = [];
    let prev = "";
    for (const tk of tokens) {
      let text = tk.value;
      if (
        (tk.type === TokenType.IDENT || tk.type === TokenType.KEYWORD) &&
        !LITERAL_WORDS.has(tk.value)
      ) {
        text = JSON.stringify(tk.value);
      }
      const noSpace =
        parts.length === 0 ||
        text === "," ||
        text === "]" ||
        text === ")" ||
        text === "." ||
        prev === "[" ||
        prev === "(" ||
        prev === ".";
      parts.push(noSpace ? text : " " + text);
      prev = tk.value;
    }
    return parts.join("").trim();
  }

  /* ── small utilities ───────────────────────────────────────────────── */

  /** Strip surrounding single/double quotes (and backticks) from a literal. */
  private unquote(s: string): string {
    if (s.length >= 2) {
      const q = s[0];
      if ((q === '"' || q === "'" || q === "`") && s[s.length - 1] === q) {
        return s.slice(1, -1);
      }
    }
    return s;
  }
}

/**
 * Convenience wrapper: parse a token stream into a program.
 * @param tokens Token stream from the lexer.
 * @param source Original source text.
 * @returns The parsed {@link Program}.
 */
export function parse(tokens: Token[], source: string): Program {
  return new Parser(tokens, source).parse();
}
