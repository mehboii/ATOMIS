//! Hand-written lexer (tokenizer) for the Atomis language.
//!
//! Faithful port of `src/lexer.ts`. Converts `.ato` source text into a flat
//! `Token` stream consumed by the parser.
//!
//! Source offsets (`start`/`end`) are *character* indices into the source, to
//! match JavaScript string indexing used by the TS reference for verbatim
//! passthrough slicing. The source is held as a `Vec<char>` so indexing and
//! slicing stay consistent with that model.

/// All token categories produced by the lexer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenType {
    Keyword,
    Ident,
    Number,
    String,
    Operator,
    Punctuation,
    Decorator,
    LBrace,
    RBrace,
    Arrow,
    Newline,
    Comment,
    Eof,
}

/// A single lexical token with source position.
#[derive(Debug, Clone)]
pub struct Token {
    pub ttype: TokenType,
    pub value: String,
    /// 1-based source line.
    pub line: usize,
    /// 1-based source column.
    pub col: usize,
    /// 0-based char offset of the first character of the token.
    pub start: usize,
    /// 0-based char offset just past the last character of the token.
    pub end: usize,
}

/// Atomis-specific and GhostNet keywords (matches `ATOMIS_KEYWORDS`).
const ATOMIS_KEYWORDS: &[&str] = &[
    // Layer 2 — sugar
    "atom", "fn", "pure", "match", "guard", "view", "output", "else",
    // Layer 3 — GhostNet
    "node", "channel", "mesh", "connect", "encrypt", "via",
    // Result / network type identifiers
    "Ok", "Err", "Result", "Node", "Channel", "Mesh", "Packet", "KeyPair",
];

fn is_atomis_keyword(s: &str) -> bool {
    ATOMIS_KEYWORDS.contains(&s)
}

/// Punctuation characters emitted as PUNCTUATION (excluding braces).
const PUNCTUATION: &[char] = &['(', ')', '[', ']', ',', ';', ':', '.', '?', '#'];

/// Multi-character operators, longest first so the scanner is greedy.
/// Order is significant and must match `MULTI_OPERATORS` in lexer.ts.
const MULTI_OPERATORS: &[&str] = &[
    "===", "!==", "**=", "...", "&&=", "||=", "??=", ">>>", "==", "!=", "<=",
    ">=", "&&", "||", "??", "?.", "+=", "-=", "*=", "/=", "%=", "++", "--",
    "=>", "<<", ">>",
];

/// Single-character operators.
const SINGLE_OPERATORS: &[char] =
    &['+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~'];

/// The Atomis lexer. Construct with source text, then call [`Lexer::tokenize`].
pub struct Lexer {
    src: Vec<char>,
    pos: usize,
    line: usize,
    col: usize,
    tokens: Vec<Token>,
    token_start: usize,
}

impl Lexer {
    pub fn new(source: &str) -> Self {
        Lexer {
            src: source.chars().collect(),
            pos: 0,
            line: 1,
            col: 1,
            tokens: Vec::new(),
            token_start: 0,
        }
    }

    /// Tokenize the entire source into a token array terminated by EOF.
    pub fn tokenize(mut self) -> Vec<Token> {
        while !self.at_end() {
            self.scan_token();
        }
        self.token_start = self.pos;
        self.push(TokenType::Eof, String::new(), self.line, self.col);
        self.tokens
    }

    /* ── character helpers ─────────────────────────────────────────────── */

    fn at_end(&self) -> bool {
        self.pos >= self.src.len()
    }

    /// Mirrors `peek(offset)`; returns `'\0'` past end (JS returns `""`).
    fn peek(&self, offset: usize) -> char {
        self.src.get(self.pos + offset).copied().unwrap_or('\0')
    }

    fn advance(&mut self) -> char {
        let ch = self.src[self.pos];
        self.pos += 1;
        if ch == '\n' {
            self.line += 1;
            self.col = 1;
        } else {
            self.col += 1;
        }
        ch
    }

    fn push(&mut self, ttype: TokenType, value: String, line: usize, col: usize) {
        self.tokens.push(Token {
            ttype,
            value,
            line,
            col,
            start: self.token_start,
            end: self.pos,
        });
    }

    /* ── main scanner ──────────────────────────────────────────────────── */

    fn scan_token(&mut self) {
        self.token_start = self.pos;
        let start_line = self.line;
        let start_col = self.col;
        let ch = self.peek(0);

        // Newlines are significant for cell/statement boundaries.
        if ch == '\n' {
            self.advance();
            self.push(TokenType::Newline, "\n".to_string(), start_line, start_col);
            return;
        }

        // Skip non-newline whitespace.
        if ch == ' ' || ch == '\t' || ch == '\r' {
            self.advance();
            return;
        }

        // Comments.
        if ch == '/' && self.peek(1) == '/' {
            self.scan_line_comment(start_line, start_col);
            return;
        }
        if ch == '/' && self.peek(1) == '*' {
            self.scan_block_comment(start_line, start_col);
            return;
        }

        // Strings.
        if ch == '"' || ch == '\'' {
            self.scan_string(ch, start_line, start_col);
            return;
        }
        if ch == '`' {
            self.scan_template(start_line, start_col);
            return;
        }

        // Decorators: @name.
        if ch == '@' {
            self.scan_decorator(start_line, start_col);
            return;
        }

        // Numbers.
        if is_digit(ch) {
            self.scan_number(start_line, start_col);
            return;
        }

        // Identifiers / keywords.
        if is_ident_start(ch) {
            self.scan_ident(start_line, start_col);
            return;
        }

        // Braces.
        if ch == '{' {
            self.advance();
            self.push(TokenType::LBrace, "{".to_string(), start_line, start_col);
            return;
        }
        if ch == '}' {
            self.advance();
            self.push(TokenType::RBrace, "}".to_string(), start_line, start_col);
            return;
        }

        // Arrow `->` (distinct from `=>`).
        if ch == '-' && self.peek(1) == '>' {
            self.advance();
            self.advance();
            self.push(TokenType::Arrow, "->".to_string(), start_line, start_col);
            return;
        }

        // Multi-char operators.
        for op in MULTI_OPERATORS {
            if self.match_ahead(op) {
                for _ in 0..op.chars().count() {
                    self.advance();
                }
                self.push(TokenType::Operator, (*op).to_string(), start_line, start_col);
                return;
            }
        }

        // Single-char operators.
        if SINGLE_OPERATORS.contains(&ch) {
            self.advance();
            self.push(TokenType::Operator, ch.to_string(), start_line, start_col);
            return;
        }

        // Punctuation.
        if PUNCTUATION.contains(&ch) {
            self.advance();
            self.push(TokenType::Punctuation, ch.to_string(), start_line, start_col);
            return;
        }

        // Unknown character — emit as punctuation to keep scanning resilient.
        self.advance();
        self.push(TokenType::Punctuation, ch.to_string(), start_line, start_col);
    }

    /* ── sub-scanners ──────────────────────────────────────────────────── */

    fn scan_line_comment(&mut self, line: usize, col: usize) {
        let mut text = String::new();
        while !self.at_end() && self.peek(0) != '\n' {
            text.push(self.advance());
        }
        self.push(TokenType::Comment, text, line, col);
    }

    fn scan_block_comment(&mut self, line: usize, col: usize) {
        let mut text = String::new();
        // consume "/*"
        text.push(self.advance());
        text.push(self.advance());
        while !self.at_end() && !(self.peek(0) == '*' && self.peek(1) == '/') {
            text.push(self.advance());
        }
        if !self.at_end() {
            text.push(self.advance()); // *
            text.push(self.advance()); // /
        }
        self.push(TokenType::Comment, text, line, col);
    }

    fn scan_string(&mut self, quote: char, line: usize, col: usize) {
        let mut text = String::new();
        text.push(self.advance()); // opening quote
        while !self.at_end() && self.peek(0) != quote {
            if self.peek(0) == '\\' {
                text.push(self.advance()); // backslash
                if !self.at_end() {
                    text.push(self.advance()); // escaped char
                }
                continue;
            }
            if self.peek(0) == '\n' {
                break; // unterminated; stop at newline
            }
            text.push(self.advance());
        }
        if !self.at_end() && self.peek(0) == quote {
            text.push(self.advance()); // closing quote
        }
        self.push(TokenType::String, text, line, col);
    }

    /// Scan a template literal, preserving backticks and `${ ... }`
    /// interpolation regions (including nested braces) as a single STRING token.
    fn scan_template(&mut self, line: usize, col: usize) {
        let mut text = String::new();
        text.push(self.advance()); // opening backtick
        while !self.at_end() && self.peek(0) != '`' {
            if self.peek(0) == '\\' {
                text.push(self.advance());
                if !self.at_end() {
                    text.push(self.advance());
                }
                continue;
            }
            if self.peek(0) == '$' && self.peek(1) == '{' {
                text.push(self.advance()); // $
                text.push(self.advance()); // {
                let mut depth = 1;
                while !self.at_end() && depth > 0 {
                    let c = self.peek(0);
                    if c == '{' {
                        depth += 1;
                    } else if c == '}' {
                        depth -= 1;
                    }
                    if depth == 0 {
                        text.push(self.advance()); // closing }
                        break;
                    }
                    text.push(self.advance());
                }
                continue;
            }
            text.push(self.advance());
        }
        if !self.at_end() && self.peek(0) == '`' {
            text.push(self.advance()); // closing backtick
        }
        self.push(TokenType::String, text, line, col);
    }

    fn scan_decorator(&mut self, line: usize, col: usize) {
        self.advance(); // @
        let mut name = String::new();
        while !self.at_end() && is_ident_part(self.peek(0)) {
            name.push(self.advance());
        }
        self.push(TokenType::Decorator, format!("@{}", name), line, col);
    }

    fn scan_number(&mut self, line: usize, col: usize) {
        let mut text = String::new();
        // Hex / binary / octal prefixes.
        if self.peek(0) == '0' && is_radix_prefix(self.peek(1)) {
            text.push(self.advance()); // 0
            text.push(self.advance()); // x/b/o
            while !self.at_end() && is_radix_digit(self.peek(0)) {
                text.push(self.advance());
            }
            self.push(TokenType::Number, text, line, col);
            return;
        }
        while !self.at_end() && (is_digit(self.peek(0)) || self.peek(0) == '_') {
            text.push(self.advance());
        }
        if self.peek(0) == '.' && is_digit(self.peek(1)) {
            text.push(self.advance()); // .
            while !self.at_end() && (is_digit(self.peek(0)) || self.peek(0) == '_') {
                text.push(self.advance());
            }
        }
        // Exponent.
        if self.peek(0) == 'e' || self.peek(0) == 'E' {
            text.push(self.advance());
            if self.peek(0) == '+' || self.peek(0) == '-' {
                text.push(self.advance());
            }
            while !self.at_end() && is_digit(self.peek(0)) {
                text.push(self.advance());
            }
        }
        // BigInt suffix.
        if self.peek(0) == 'n' {
            text.push(self.advance());
        }
        self.push(TokenType::Number, text, line, col);
    }

    fn scan_ident(&mut self, line: usize, col: usize) {
        let mut text = String::new();
        while !self.at_end() && is_ident_part(self.peek(0)) {
            text.push(self.advance());
        }
        let ttype = if is_atomis_keyword(&text) {
            TokenType::Keyword
        } else {
            TokenType::Ident
        };
        self.push(ttype, text, line, col);
    }

    /* ── predicates ────────────────────────────────────────────────────── */

    fn match_ahead(&self, s: &str) -> bool {
        let chars: Vec<char> = s.chars().collect();
        if self.pos + chars.len() > self.src.len() {
            return false;
        }
        for (i, c) in chars.iter().enumerate() {
            if self.src[self.pos + i] != *c {
                return false;
            }
        }
        true
    }
}

fn is_digit(ch: char) -> bool {
    ch >= '0' && ch <= '9'
}

/// Matches `/[A-Za-z_$]/`.
fn is_ident_start(ch: char) -> bool {
    ch.is_ascii_alphabetic() || ch == '_' || ch == '$'
}

/// Matches `/[A-Za-z0-9_$]/`.
fn is_ident_part(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '$'
}

/// Matches `/[xXbBoO]/`.
fn is_radix_prefix(ch: char) -> bool {
    matches!(ch, 'x' | 'X' | 'b' | 'B' | 'o' | 'O')
}

/// Matches `/[0-9a-fA-F_]/`.
fn is_radix_digit(ch: char) -> bool {
    ch.is_ascii_hexdigit() || ch == '_'
}

/// Convenience wrapper: tokenize a source string in one call.
pub fn tokenize(source: &str) -> Vec<Token> {
    Lexer::new(source).tokenize()
}

/// Port of `src/tests/lexer.test.ts` (14 cases).
#[cfg(test)]
mod tests {
    use super::*;

    /// Tokenize and drop trivia (NEWLINE/COMMENT/EOF) for terse assertions.
    fn meaningful(src: &str) -> Vec<Token> {
        tokenize(src)
            .into_iter()
            .filter(|t| {
                t.ttype != TokenType::Newline
                    && t.ttype != TokenType::Eof
                    && t.ttype != TokenType::Comment
            })
            .collect()
    }

    #[test]
    fn tokenizes_a_simple_atom_declaration() {
        let toks = meaningful("atom x = 5");
        assert_eq!(toks[0].ttype, TokenType::Keyword);
        assert_eq!(toks[0].value, "atom");
        assert_eq!(toks[1].ttype, TokenType::Ident);
        assert_eq!(toks[1].value, "x");
        assert_eq!(toks[2].value, "=");
        assert_eq!(toks[3].ttype, TokenType::Number);
        assert_eq!(toks[3].value, "5");
    }

    #[test]
    fn recognizes_atomis_keywords() {
        for kw in ["fn", "pure", "match", "guard", "node", "channel", "mesh", "connect", "encrypt"] {
            let toks = meaningful(kw);
            assert_eq!(toks[0].ttype, TokenType::Keyword, "{} should be a KEYWORD", kw);
        }
    }

    #[test]
    fn distinguishes_arrow_from_fat_arrow() {
        let arrow = meaningful("->");
        assert_eq!(arrow[0].ttype, TokenType::Arrow);
        let fat = meaningful("=>");
        assert_eq!(fat[0].ttype, TokenType::Operator);
        assert_eq!(fat[0].value, "=>");
    }

    #[test]
    fn tokenizes_decorators() {
        let toks = meaningful("@cell @render @import @meta");
        let vals: Vec<&str> = toks.iter().map(|t| t.value.as_str()).collect();
        assert_eq!(vals, ["@cell", "@render", "@import", "@meta"]);
        assert!(toks.iter().all(|t| t.ttype == TokenType::Decorator));
    }

    #[test]
    fn captures_double_and_single_quoted_strings() {
        let toks = meaningful("\"hello\" 'world'");
        assert_eq!(toks[0].ttype, TokenType::String);
        assert_eq!(toks[0].value, "\"hello\"");
        assert_eq!(toks[1].value, "'world'");
    }

    #[test]
    fn captures_template_literals_as_one_token() {
        let toks = meaningful("`Found ${count} peers`");
        assert_eq!(toks.len(), 1);
        assert_eq!(toks[0].ttype, TokenType::String);
        assert_eq!(toks[0].value, "`Found ${count} peers`");
    }

    #[test]
    fn handles_nested_braces_inside_interpolation() {
        let toks = meaningful("`${ {a:1}.a }`");
        assert_eq!(toks.len(), 1);
        assert_eq!(toks[0].value, "`${ {a:1}.a }`");
    }

    #[test]
    fn skips_line_and_block_comments_as_comment_tokens() {
        let all = tokenize("// hi\n/* block */ atom");
        let comments: Vec<&Token> =
            all.iter().filter(|t| t.ttype == TokenType::Comment).collect();
        assert_eq!(comments.len(), 2);
        let kw = all.iter().find(|t| t.value == "atom").unwrap();
        assert_eq!(kw.ttype, TokenType::Keyword);
    }

    #[test]
    fn emits_newline_tokens() {
        let all = tokenize("a\nb");
        assert!(all.iter().any(|t| t.ttype == TokenType::Newline));
    }

    #[test]
    fn recognizes_braces() {
        let toks = meaningful("{ }");
        assert_eq!(toks[0].ttype, TokenType::LBrace);
        assert_eq!(toks[1].ttype, TokenType::RBrace);
    }

    #[test]
    fn tokenizes_multi_char_operators_greedily() {
        let toks = meaningful("a === b && c");
        assert_eq!(toks[1].value, "===");
        assert_eq!(toks[3].value, "&&");
    }

    #[test]
    fn tokenizes_numbers_including_floats_and_hex() {
        let toks = meaningful("3.14 0xFF 42");
        assert_eq!(toks[0].value, "3.14");
        assert_eq!(toks[1].value, "0xFF");
        assert_eq!(toks[2].value, "42");
        assert!(toks.iter().all(|t| t.ttype == TokenType::Number));
    }

    #[test]
    fn records_source_positions_and_offsets() {
        let toks = tokenize("atom x");
        assert_eq!(toks[0].line, 1);
        assert_eq!(toks[0].col, 1);
        assert_eq!(toks[0].start, 0);
        assert_eq!(toks[0].end, 4);
    }

    #[test]
    fn always_terminates_with_eof() {
        let toks = Lexer::new("anything").tokenize();
        assert_eq!(toks[toks.len() - 1].ttype, TokenType::Eof);
    }
}
