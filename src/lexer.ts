/**
 * @file lexer.ts
 * @module atomis/lexer
 *
 * Hand-written lexer (tokenizer) for the Atomis language.
 *
 * It converts `.ato` source text into a flat {@link Token} stream consumed by
 * the parser. The lexer understands the full set of TypeScript lexical tokens
 * needed for passthrough plus the additional Atomis / GhostNet keywords and
 * the `->` arrow operator.
 *
 * Notable handling:
 *  - Line comments (`// ...`) and block comments (`/* ... *\/`)
 *  - Double / single quoted strings with escapes
 *  - Template literals with `${ ... }` interpolation (emitted as a single
 *    STRING token preserving the backticks and interpolation text)
 *  - `->` (ARROW) distinct from `=>` (FAT_ARROW, emitted as OPERATOR)
 *  - Decorators `@cell`, `@render`, `@import`, `@meta`
 */

/** All token categories produced by the lexer. */
export enum TokenType {
  KEYWORD = "KEYWORD",
  IDENT = "IDENT",
  NUMBER = "NUMBER",
  STRING = "STRING",
  OPERATOR = "OPERATOR",
  PUNCTUATION = "PUNCTUATION",
  DECORATOR = "DECORATOR",
  LBRACE = "LBRACE",
  RBRACE = "RBRACE",
  ARROW = "ARROW",
  NEWLINE = "NEWLINE",
  COMMENT = "COMMENT",
  EOF = "EOF",
}

/** A single lexical token with source position. */
export interface Token {
  /** Token category. */
  type: TokenType;
  /** Raw matched text (string tokens keep their quotes/backticks). */
  value: string;
  /** 1-based source line. */
  line: number;
  /** 1-based source column. */
  col: number;
  /** 0-based character offset of the first character of the token. */
  start: number;
  /** 0-based character offset just past the last character of the token. */
  end: number;
}

/**
 * Atomis-specific and GhostNet keywords. TypeScript keywords that matter for
 * the sugar layer are also included; everything else (e.g. `class`,
 * `interface`) is lexed as IDENT and handled as passthrough by the parser.
 */
export const ATOMIS_KEYWORDS: ReadonlySet<string> = new Set([
  // Layer 2 — sugar
  "atom",
  "fn",
  "pure",
  "match",
  "guard",
  "view",
  "output",
  "else",
  // Layer 3 — GhostNet
  "node",
  "channel",
  "mesh",
  "connect",
  "encrypt",
  "via",
  // Result / network type identifiers
  "Ok",
  "Err",
  "Result",
  "Node",
  "Channel",
  "Mesh",
  "Packet",
  "KeyPair",
]);

/** Recognized decorator names. */
export const DECORATORS: ReadonlySet<string> = new Set([
  "cell",
  "render",
  "import",
  "meta",
]);

/** Punctuation characters emitted as PUNCTUATION (excluding braces). */
const PUNCTUATION = new Set([
  "(",
  ")",
  "[",
  "]",
  ",",
  ";",
  ":",
  ".",
  "?",
  "#",
]);

/** Multi-character operators, longest first so the scanner is greedy. */
const MULTI_OPERATORS = [
  "===",
  "!==",
  "**=",
  "...",
  "&&=",
  "||=",
  "??=",
  ">>>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "++",
  "--",
  "=>", // fat arrow (TS) — distinct from "->"
  "<<",
  ">>",
];

/** Single-character operators. */
const SINGLE_OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "<",
  ">",
  "!",
  "&",
  "|",
  "^",
  "~",
]);

/**
 * The Atomis lexer. Construct with source text, then call {@link tokenize}.
 */
export class Lexer {
  private readonly src: string;
  private pos = 0;
  private line = 1;
  private col = 1;
  private readonly tokens: Token[] = [];
  /** Character offset where the token currently being scanned began. */
  private tokenStart = 0;

  /**
   * @param source Raw `.ato` source text.
   */
  constructor(source: string) {
    this.src = source;
  }

  /**
   * Tokenize the entire source into a token array terminated by an EOF token.
   * @returns The complete token stream.
   */
  public tokenize(): Token[] {
    while (!this.atEnd()) {
      this.scanToken();
    }
    this.tokenStart = this.pos;
    this.push(TokenType.EOF, "");
    return this.tokens;
  }

  /* ── character helpers ─────────────────────────────────────────────── */

  private atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  private peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }

  private advance(): string {
    const ch = this.src[this.pos++];
    if (ch === "\n") {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  private push(type: TokenType, value: string, line = this.line, col = this.col): void {
    this.tokens.push({
      type,
      value,
      line,
      col,
      start: this.tokenStart,
      end: this.pos,
    });
  }

  /* ── main scanner ──────────────────────────────────────────────────── */

  private scanToken(): void {
    this.tokenStart = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    const ch = this.peek();

    // Newlines are significant for cell/statement boundaries.
    if (ch === "\n") {
      this.advance();
      this.push(TokenType.NEWLINE, "\n", startLine, startCol);
      return;
    }

    // Skip non-newline whitespace.
    if (ch === " " || ch === "\t" || ch === "\r") {
      this.advance();
      return;
    }

    // Comments.
    if (ch === "/" && this.peek(1) === "/") {
      this.scanLineComment(startLine, startCol);
      return;
    }
    if (ch === "/" && this.peek(1) === "*") {
      this.scanBlockComment(startLine, startCol);
      return;
    }

    // Strings.
    if (ch === '"' || ch === "'") {
      this.scanString(ch, startLine, startCol);
      return;
    }
    if (ch === "`") {
      this.scanTemplate(startLine, startCol);
      return;
    }

    // Decorators: @name.
    if (ch === "@") {
      this.scanDecorator(startLine, startCol);
      return;
    }

    // Numbers.
    if (this.isDigit(ch)) {
      this.scanNumber(startLine, startCol);
      return;
    }

    // Identifiers / keywords.
    if (this.isIdentStart(ch)) {
      this.scanIdent(startLine, startCol);
      return;
    }

    // Braces.
    if (ch === "{") {
      this.advance();
      this.push(TokenType.LBRACE, "{", startLine, startCol);
      return;
    }
    if (ch === "}") {
      this.advance();
      this.push(TokenType.RBRACE, "}", startLine, startCol);
      return;
    }

    // Arrow `->` (distinct from `=>`).
    if (ch === "-" && this.peek(1) === ">") {
      this.advance();
      this.advance();
      this.push(TokenType.ARROW, "->", startLine, startCol);
      return;
    }

    // Multi-char operators.
    for (const op of MULTI_OPERATORS) {
      if (this.matchAhead(op)) {
        for (let i = 0; i < op.length; i++) this.advance();
        this.push(TokenType.OPERATOR, op, startLine, startCol);
        return;
      }
    }

    // Single-char operators.
    if (SINGLE_OPERATORS.has(ch)) {
      this.advance();
      this.push(TokenType.OPERATOR, ch, startLine, startCol);
      return;
    }

    // Punctuation.
    if (PUNCTUATION.has(ch)) {
      this.advance();
      this.push(TokenType.PUNCTUATION, ch, startLine, startCol);
      return;
    }

    // Unknown character — emit as punctuation to keep scanning resilient.
    this.advance();
    this.push(TokenType.PUNCTUATION, ch, startLine, startCol);
  }

  /* ── sub-scanners ──────────────────────────────────────────────────── */

  private scanLineComment(line: number, col: number): void {
    let text = "";
    while (!this.atEnd() && this.peek() !== "\n") {
      text += this.advance();
    }
    this.push(TokenType.COMMENT, text, line, col);
  }

  private scanBlockComment(line: number, col: number): void {
    let text = "";
    // consume "/*"
    text += this.advance();
    text += this.advance();
    while (!this.atEnd() && !(this.peek() === "*" && this.peek(1) === "/")) {
      text += this.advance();
    }
    if (!this.atEnd()) {
      text += this.advance(); // *
      text += this.advance(); // /
    }
    this.push(TokenType.COMMENT, text, line, col);
  }

  private scanString(quote: string, line: number, col: number): void {
    let text = this.advance(); // opening quote
    while (!this.atEnd() && this.peek() !== quote) {
      if (this.peek() === "\\") {
        text += this.advance(); // backslash
        if (!this.atEnd()) text += this.advance(); // escaped char
        continue;
      }
      if (this.peek() === "\n") break; // unterminated; stop at newline
      text += this.advance();
    }
    if (!this.atEnd() && this.peek() === quote) {
      text += this.advance(); // closing quote
    }
    this.push(TokenType.STRING, text, line, col);
  }

  /**
   * Scan a template literal, preserving backticks and `${ ... }`
   * interpolation regions (including nested braces) as a single STRING token.
   */
  private scanTemplate(line: number, col: number): void {
    let text = this.advance(); // opening backtick
    while (!this.atEnd() && this.peek() !== "`") {
      if (this.peek() === "\\") {
        text += this.advance();
        if (!this.atEnd()) text += this.advance();
        continue;
      }
      if (this.peek() === "$" && this.peek(1) === "{") {
        text += this.advance(); // $
        text += this.advance(); // {
        let depth = 1;
        while (!this.atEnd() && depth > 0) {
          const c = this.peek();
          if (c === "{") depth++;
          else if (c === "}") depth--;
          if (depth === 0) {
            text += this.advance(); // closing }
            break;
          }
          text += this.advance();
        }
        continue;
      }
      text += this.advance();
    }
    if (!this.atEnd() && this.peek() === "`") {
      text += this.advance(); // closing backtick
    }
    this.push(TokenType.STRING, text, line, col);
  }

  private scanDecorator(line: number, col: number): void {
    this.advance(); // @
    let name = "";
    while (!this.atEnd() && this.isIdentPart(this.peek())) {
      name += this.advance();
    }
    // Always emit a DECORATOR token; the parser validates the name.
    this.push(TokenType.DECORATOR, "@" + name, line, col);
  }

  private scanNumber(line: number, col: number): void {
    let text = "";
    // Hex / binary / octal prefixes.
    if (this.peek() === "0" && /[xXbBoO]/.test(this.peek(1))) {
      text += this.advance(); // 0
      text += this.advance(); // x/b/o
      while (!this.atEnd() && /[0-9a-fA-F_]/.test(this.peek())) {
        text += this.advance();
      }
      this.push(TokenType.NUMBER, text, line, col);
      return;
    }
    while (!this.atEnd() && (this.isDigit(this.peek()) || this.peek() === "_")) {
      text += this.advance();
    }
    if (this.peek() === "." && this.isDigit(this.peek(1))) {
      text += this.advance(); // .
      while (!this.atEnd() && (this.isDigit(this.peek()) || this.peek() === "_")) {
        text += this.advance();
      }
    }
    // Exponent.
    if (/[eE]/.test(this.peek())) {
      text += this.advance();
      if (/[+-]/.test(this.peek())) text += this.advance();
      while (!this.atEnd() && this.isDigit(this.peek())) text += this.advance();
    }
    // BigInt suffix.
    if (this.peek() === "n") text += this.advance();
    this.push(TokenType.NUMBER, text, line, col);
  }

  private scanIdent(line: number, col: number): void {
    let text = "";
    while (!this.atEnd() && this.isIdentPart(this.peek())) {
      text += this.advance();
    }
    const type = ATOMIS_KEYWORDS.has(text) ? TokenType.KEYWORD : TokenType.IDENT;
    this.push(type, text, line, col);
  }

  /* ── predicates ────────────────────────────────────────────────────── */

  private matchAhead(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isIdentStart(ch: string): boolean {
    return /[A-Za-z_$]/.test(ch);
  }

  private isIdentPart(ch: string): boolean {
    return /[A-Za-z0-9_$]/.test(ch);
  }
}

/**
 * Convenience wrapper: tokenize a source string in one call.
 * @param source Raw `.ato` source text.
 * @returns The token stream (terminated by EOF).
 */
export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}
